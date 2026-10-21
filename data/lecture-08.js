window.PAGE = {
 "num": 8,
 "title": "Computer Architecture for HFT",
 "summary": "How the machine underneath C++ really behaves: registers and assembly, the cache hierarchy and 64-byte lines, virtual memory with pages and the TLB, pipelines and branch prediction, and the kernel boundary (syscalls, interrupts, file descriptors, sockets, epoll). It ends with the costs that shape HFT code: MESI coherence, malloc vs tcmalloc, padding and alignment, false sharing, and the rules of the hot path.",
 "notes": [
  {
   "heading": "Registers and x86-64 assembly",
   "body": "Registers are the fastest storage in the machine: read in 0 extra cycles, sitting inside the core. Everything the CPU computes goes through them; memory is only reached with loads and stores.\n\n| Register(s) | Role in the System V AMD64 ABI (Linux) |\n|---|---|\n| `rax` | return value; scratch |\n| `rdi, rsi, rdx, rcx, r8, r9` | integer/pointer arguments 1–6 (more go on the stack) |\n| `xmm0–xmm7` | floating-point arguments and return (`xmm0`) |\n| `rsp` | stack pointer (top of stack; stack grows **down**) |\n| `rbp` | frame pointer (optional with `-fomit-frame-pointer`, the default at -O2) |\n| `rbx, rbp, r12–r15` | **callee-saved**: a function that uses them must push/pop them |\n| `rip` | instruction pointer; `[rip+x]` addressing reaches globals/string literals |\n| `fs` | segment base used for thread-local storage (and the stack canary at `fs:0x28`) |\n\n`eax` is the low 32 bits of `rax`; writing `eax` zeroes the top 32 bits, which is why `xor eax,eax` is the idiom for \"set to 0\".\n\n### Reading a function\n```cpp\nint add(int a, int b) { return a + b; }\n// g++ -O2:\n// add:  lea eax, [rdi+rsi]   ; a in edi, b in esi, result in eax\n//       ret\n```\n\n**In class:** we compiled a small program (`int N; cin >> N; int arr[N];`) and read it with `objdump -d -M intel`. The listing showed:\n- the **prologue**: `push rbp; mov rbp,rsp`, then `push r15 … push rbx` (callee-saved registers the function will clobber) and `sub rsp,0x28` to reserve locals;\n- the **stack canary**: `mov rax, QWORD PTR fs:0x28` stored at `[rbp-0x38]` and re-checked before `ret` (a mismatch calls `__stack_chk_fail`): that is `-fstack-protector`;\n- the call `cin >> N`: `lea rsi,[rbp-0x4c]` (address of N, 2nd arg) and `lea rdi,[rip+…]` (address of `std::cin`, 1st arg, the `this` pointer) then `call` (the target is 0 because the object file is not linked yet; the linker fills in the relocation);\n- the **variable-length array**: it computes `N*4`, rounds up to 16 (`add 15`, `div 16`, `imul 16`) to keep `rsp` 16-byte aligned, then a loop `sub rsp,0x1000; or QWORD PTR [rsp+0xff8],0` that moves the stack down **one 4 KiB page at a time and touches each page** (stack-clash protection, so a huge VLA cannot jump over the guard page);\n- the **epilogue**: restore `rsp`, `pop` the saved registers in reverse order, `ret`;\n- a separate `_GLOBAL__sub_I_main` / `__static_initialization_and_destruction_0` that constructs `std::ios_base::Init` (the iostream static initialiser) before `main`.\n\nVLAs (`int arr[N]` with runtime N) are a GCC extension, not standard C++. Use `std::vector` or a fixed-size `std::array`."
  },
  {
   "heading": "Caches, the memory hierarchy and the cache line",
   "body": "DRAM is ~100x slower than the core, so the CPU keeps copies of recently used memory in caches.\n\n| Level | Typical size (per core unless noted) | Latency |\n|---|---|---|\n| Registers | ~16 GPRs + vector regs | 0 cycles |\n| L1d | 32–48 KiB | ~4 cycles ≈ 1 ns |\n| L2 | 256 KiB–2 MiB | ~12 cycles ≈ 3–4 ns |\n| L3 (shared by cores) | 8–64 MiB | ~40 cycles ≈ 10–20 ns |\n| DRAM | GBs | ~60–100 ns |\n| NVMe SSD | TBs | ~10–100 µs |\n\nThe unit of transfer is the **cache line: 64 bytes** on x86-64 (128 B pairs are prefetched on some Intel parts; Apple M-series uses 128 B lines). Reading one `int` pulls in its whole 64-byte line, so the next 15 ints are free.\n\n- **Spatial locality**: use neighbouring bytes (arrays, `std::vector`, structs of hot fields).\n- **Temporal locality**: reuse the same data soon (small working sets, loop blocking/tiling).\n- The **hardware prefetcher** detects sequential and constant-stride patterns and fetches lines ahead; pointer chasing (`std::list`, `std::map`) defeats it, so each node is a potential ~100 ns miss.\n- Caches are **set-associative** (e.g. L1d 12-way): an address maps to one set; strides that are large powers of two (e.g. 4096 B) map to the same set and cause conflict misses.\n- Writes go to L1 (write-back); the line is written to memory only when evicted.\n\n```cpp\nint a[4096][4096];\nlong s = 0;\nfor (int i = 0; i < 4096; ++i)        // row-major: sequential, 1 miss per 16 ints\n    for (int j = 0; j < 4096; ++j) s += a[i][j];\nfor (int j = 0; j < 4096; ++j)        // column-major: stride 16 KiB, ~1 miss per access\n    for (int i = 0; i < 4096; ++i) s += a[i][j];   // typically 5-10x slower\n```\n\nHFT consequence: keep the hot path's data small enough for L1/L2, contiguous, and **warm** (touch it even when there is no trading so it stays cached)."
  },
  {
   "heading": "Virtual memory, paging, physical memory and the TLB",
   "body": "Every process sees its own **virtual address space**; the MMU translates virtual addresses to **physical** addresses (real DRAM frames) using **page tables** maintained by the kernel.\n\n- **Page** = unit of mapping: **4 KiB** by default (offset = low 12 bits). Huge pages: **2 MiB** and **1 GiB**.\n- x86-64 uses **4-level page tables** (PML4 → PDPT → PD → PT), 9 bits of index per level: 4×9 + 12 = **48-bit** virtual addresses (256 TiB). 5-level paging gives 57 bits.\n- Each page-table entry holds the physical frame number plus bits: present, writable, user/supervisor, accessed, dirty, no-execute.\n- A translation without help costs **4 dependent memory reads** (a page walk). The **TLB** (Translation Lookaside Buffer) caches recent translations: L1 dTLB ~64 entries, L2 STLB ~1.5–2K entries. TLB hit: ~free; miss: page walk ~10–100+ cycles.\n- **TLB reach** = entries × page size: 64 × 4 KiB = 256 KiB; with 2 MiB huge pages, 64 × 2 MiB = 128 MiB. Huge pages are a standard HFT trick for big order books / pools.\n- **Demand paging**: `malloc`/`mmap` only reserve virtual addresses. Physical frames are allocated on the **first touch**, via a **page fault** (minor fault ≈ 0.5–1 µs+, includes zeroing the page; major fault = read from disk, ms).\n- **Copy-on-write**: after `fork`, pages are shared read-only until written.\n- Context switch to another process changes `cr3` (page-table root) and can flush TLB entries (PCID mitigates this); threads of one process share page tables, so switching between them is cheaper.\n\nWhy it matters for C++: a pointer value is a *virtual* address; two processes can hold the same pointer value pointing to different memory. Stack overflow is caught by an unmapped **guard page**, and `nullptr` dereference faults because page 0 is unmapped.\n\n**In class:** we ran two loops while watching memory in `top`: one called a function with `int arr[1024*1024]` (4 MiB on the stack, fits in the default 8 MiB `ulimit -s`; costs only an `rsp` adjustment) and one that did `new int[1024*2024]` (~8 MiB) each second. The heap one goes through `malloc`, which for blocks above the ~128 KiB `M_MMAP_THRESHOLD` calls `mmap`/`munmap` directly, so pages are mapped and returned each time; untouched pages never even become resident. (Note: that class snippet used `delete arr;` on an array from `new[]`: that is undefined behaviour; it must be `delete[] arr;`.)\n\nHFT practice: pre-allocate at startup, **pre-fault** (touch every page or use `MAP_POPULATE`), `mlockall(MCL_CURRENT|MCL_FUTURE)` so nothing is swapped out, and use huge pages to cut TLB misses."
  },
  {
   "heading": "Pipelines, branch misprediction and pipeline stalls",
   "body": "A modern core is **pipelined** (fetch → decode → rename → schedule → execute → retire, ~14–20 stages) and **superscalar/out-of-order**: it keeps hundreds of instructions in flight (ROB ~200–500 entries) and retires them in order.\n\nBranches are guessed by the **branch predictor** so fetch does not wait. A wrong guess is a **misprediction**: all speculative work after the branch is flushed, costing **~15–20 cycles (≈5 ns at 4 GHz)**. Predictable branches (always taken, loop back-edges, regular patterns) are almost free.\n\nA **pipeline stall** (bubble) is any cycle where a stage cannot proceed: waiting on a cache miss (the big one: ~300 cycles for DRAM), a long-latency op (`div` ~20–40 cycles), a dependency chain, a mispredict flush, or a serialising instruction (`cpuid`, `mfence`, `lfence`).\n\n```cpp\n// Classic: summing values >= 128 from random data\nfor (int x : data) if (x >= 128) sum += x;      // random data: ~50% mispredicts\n// sort(data) first -> branch becomes predictable -> several times faster\nfor (int x : data) sum += (x >= 128) ? x : 0;   // often compiled to cmov: branchless\nfor (int x : data) sum += x & -(x >= 128);      // explicit branchless mask\n```\n\nTools: C++20 `[[likely]]` / `[[unlikely]]` (or `__builtin_expect`) arrange code layout so the hot path is the fall-through; they do not change the dynamic predictor much. **In class** (SPSC queue) we marked the \"queue full / queue empty\" checks `[[unlikely]]` so the common path is straight-line code. Measure with `perf stat -e branches,branch-misses`.\n\nBranchless code is not always faster: a `cmov` creates a data dependency, which is worse than a well-predicted branch."
  },
  {
   "heading": "Interrupts, syscalls and the kernel",
   "body": "The **kernel** runs in privileged mode (ring 0) and owns hardware, page tables, scheduling, files and the network stack. User code (ring 3) asks it for services through **system calls**.\n\n- **Syscall**: on x86-64, put the number in `rax`, args in `rdi, rsi, rdx, r10, r8, r9`, execute `syscall`; the CPU switches to ring 0, the kernel runs, `sysret` returns. Cost: ~100 ns for a trivial one (`getpid`), more with Spectre/Meltdown mitigations (KPTI swaps page tables) and cache/TLB pollution. `read`/`write`/`send`/`recv` cost ~1–5 µs including the network stack.\n- **vDSO**: `clock_gettime`/`gettimeofday` run in user space via a kernel-mapped page: ~20 ns, no ring switch. `rdtsc` reads the cycle counter directly (~7 ns).\n- **Interrupts**: hardware (NIC packet arrived, timer tick) or software signals the CPU to stop the current thread and run a handler. They add **jitter** (µs-scale pauses) to whatever was running on that core.\n- **Context switch** (scheduler moves a thread off a core): ~1–5 µs direct cost plus cold caches/TLB afterwards.\n- **Exceptions/faults**: page faults, divide by zero, also enter the kernel.\n\nHFT practice to keep the kernel off the hot path:\n- **isolate cores** (`isolcpus`, `nohz_full`, `rcu_nocbs`) and **pin** the hot thread (`taskset`, `pthread_setaffinity_np`);\n- move NIC **IRQ affinity** away from trading cores;\n- **busy-poll** instead of blocking (blocking = syscall + sleep + wakeup + context switch);\n- **kernel bypass** networking (Solarflare/AMD OpenOnload / ef_vi, DPDK, Exablaze) so packets go NIC → user memory without syscalls;\n- avoid page faults (pre-fault, `mlockall`) and logging I/O on the hot thread (hand log records to another thread through a queue)."
  },
  {
   "heading": "File descriptors and sockets",
   "body": "A **file descriptor (fd)** is a small non-negative `int` that indexes the process's **fd table** in the kernel; each entry points to an open-file description (offset, flags) which points to the underlying object. \"Everything is a file\": regular files, pipes, sockets, `epoll` instances, `eventfd`, `timerfd`, devices.\n\n- `0` = stdin, `1` = stdout, `2` = stderr; `open`/`socket` return the **lowest free** fd.\n- `read(fd, buf, n)` / `write(fd, buf, n)` work on all of them; `close(fd)` releases it. Leaked fds hit the `ulimit -n` limit (often 1024) and `accept` fails with `EMFILE`.\n- fds are inherited across `fork` (use `O_CLOEXEC` / `SOCK_CLOEXEC` to drop them on `exec`), and `dup2` redirects (how shells do `> file`).\n\n**Sockets** are fds for network endpoints.\n```cpp\n// TCP server skeleton (POSIX)\nint s = socket(AF_INET, SOCK_STREAM, 0);          // fd for a TCP socket\nsockaddr_in a{}; a.sin_family = AF_INET; a.sin_port = htons(8080);\na.sin_addr.s_addr = INADDR_ANY;\nbind(s, (sockaddr*)&a, sizeof a);                 // attach to port\nlisten(s, 128);                                   // passive socket, backlog 128\nint c = accept(s, nullptr, nullptr);              // NEW fd per client connection\nchar buf[4096]; ssize_t n = recv(c, buf, sizeof buf, 0);\nsend(c, buf, n, 0); close(c); close(s);\n```\nClient: `socket` → `connect` → `send`/`recv`.\n\n- **TCP** (`SOCK_STREAM`): reliable ordered byte stream; used for **order entry** to the exchange. Set `TCP_NODELAY` to disable Nagle's algorithm (which delays small writes to batch them).\n- **UDP** (`SOCK_DGRAM`): unreliable datagrams; exchanges publish **market data via UDP multicast** (lowest latency, sequence numbers detect gaps).\n- `O_NONBLOCK` makes `recv` return `EAGAIN` instead of sleeping, which is required for busy-polling and `epoll` edge-triggered mode.\n\n**In class:** we walked through a packet from client port 3000 to server port 8080 on `127.0.0.1` (TCP loopback): the kernel strips the **IP header** (source/destination address, checksum) and the **TCP header** (ports, SYN/ACK, sequence numbers) and hands only the payload to the process reading the socket fd. That stripping, plus the copy into user space, is exactly the work kernel-bypass stacks avoid."
  },
  {
   "heading": "epoll and I/O multiplexing",
   "body": "A server (or a feed handler with many multicast groups and sessions) must watch many fds at once without one thread per fd.\n\n| API | How it works | Cost per wait |\n|---|---|---|\n| `select` | pass bitsets of fds (max `FD_SETSIZE` = 1024), kernel scans all | O(n) + copy sets every call |\n| `poll` | array of `pollfd`, no 1024 limit | O(n) scan every call |\n| `epoll` | register fds once in a kernel object; kernel keeps a **ready list** | O(number ready) |\n\n```cpp\nint ep = epoll_create1(0);\nepoll_event ev{}; ev.events = EPOLLIN | EPOLLET; ev.data.fd = sock;\nepoll_ctl(ep, EPOLL_CTL_ADD, sock, &ev);           // register once\nepoll_event ready[64];\nfor (;;) {\n    int n = epoll_wait(ep, ready, 64, -1);          // -1 = block; 0 = poll (busy)\n    for (int i = 0; i < n; ++i) handle(ready[i].data.fd);\n}\n```\n- **Level-triggered** (default): `epoll_wait` keeps reporting the fd while data is unread.\n- **Edge-triggered** (`EPOLLET`): reported only when new data arrives, so you must read until `EAGAIN` with a **non-blocking** fd or you can stall forever.\n- Timeout `-1` sleeps (context switch on wake-up, µs of latency); timeout `0` returns immediately, which is used in a **busy-poll** loop on an isolated core to avoid sleeping.\n\n`epoll` is still a syscall per call; the lowest-latency systems bypass the kernel entirely (ef_vi, DPDK) and spin on the NIC's receive ring in user space."
  },
  {
   "heading": "Cache coherence: the MESI protocol",
   "body": "Each core has private L1/L2 caches, so two cores could hold different copies of the same line. **Cache coherence** guarantees that all cores agree on the value of each memory location; x86 uses MESI (Intel MESIF, AMD MOESI) via snooping / directory in the L3.\n\n| State | Meaning | Can read? | Can write without a bus message? |\n|---|---|---|---|\n| **M**odified | only copy, dirty (differs from memory) | yes | yes |\n| **E**xclusive | only copy, clean | yes | yes (silently becomes M) |\n| **S**hared | clean, other caches may also have it | yes | **no**: must send invalidate (RFO) |\n| **I**nvalid | not usable | miss | miss |\n\nKey transitions:\n- Core A reads a line no one has → **E**. Core B then reads it → both **S**.\n- Core A writes a line in **S** → sends **Read-For-Ownership/invalidate**; all other copies → **I**, A → **M**.\n- Core B reads a line that A holds in **M** → A supplies the data (a \"HITM\": hit-modified snoop), both go to **S** (and the line is written back).\n\nCost: moving a line between cores costs **~40–100 ns** (more across sockets/NUMA nodes). When two cores keep writing the same line, it **ping-pongs** between them, which is why shared atomic counters and **false sharing** are slow even though no lock is involved.\n\nCoherence is per line and keeps every *location* consistent; it does **not** order operations across different locations. That is the job of the memory model (atomics, fences: sessions 9–10). The core's **store buffer** lets a store retire before it is visible to others, which is why even x86 allows store→load reordering."
  },
  {
   "heading": "malloc, tcmalloc and allocation costs",
   "body": "`new` calls `operator new`, which calls `malloc` (glibc **ptmalloc2**).\n\nHow glibc malloc works:\n- Small requests are served from **free lists / bins** (tcache per thread for tiny sizes, fastbins, small/large bins) inside **arenas**; arenas get memory from the kernel with `brk`/`sbrk` (main heap) or `mmap`.\n- Large requests (≥ **128 KiB** by default, `M_MMAP_THRESHOLD`) are `mmap`ed individually and `munmap`ed on `free`.\n- Each chunk has a header (8–16 B overhead) and 16-byte alignment.\n- Costs: fast path ~20–50 ns, but **unpredictable**: it may take a lock (multiple threads share arenas), coalesce free chunks, or make a syscall and then page-fault on first touch (µs). Freeing memory allocated on another thread is extra work. Long-running processes suffer **fragmentation**.\n\n**tcmalloc** (Google, \"thread-caching malloc\"), also jemalloc / mimalloc:\n- **Why**: glibc malloc scales badly with many threads (lock contention) and fragments.\n- **How**: each thread (newer versions: each CPU) has a **local cache of free objects per size class** (~60–90 size classes); allocation is a lock-free pop from that list (~10–20 ns). A central free list and **page heap** (spans of pages) refill caches in batches; large objects come from the page heap directly.\n- **Benefits**: no lock on the fast path, less contention, less fragmentation via size classes, good for many-threaded servers. Drop-in: link `-ltcmalloc` or `LD_PRELOAD`.\n- **Costs**: higher baseline memory (per-thread caches hold memory), size-class rounding wastes some bytes, occasional slow path when the cache is empty/overfull (a refill or release spike), and it is still not deterministic.\n\nHFT rule: **no `malloc`/`new` on the hot path at all**. Pre-allocate at start-up: memory/object **pools** with intrusive free lists, ring buffers, `std::vector::reserve`, arena allocators, PMR (`std::pmr::monotonic_buffer_resource`). **In class** (memory-pool homework) the idea was exactly this: grab one huge chunk (e.g. `new std::byte[1 << 30]`) at startup, then carve orders out of it; `new` cost ~0.5 µs in our discussion vs a few ns for a pool pop."
  },
  {
   "heading": "Padding and alignment",
   "body": "Every type has an **alignment** (`alignof(T)`): its address must be a multiple of it. Usually alignof = size for scalars: `char` 1, `short` 2, `int`/`float` 4, `double`/`long`/pointers 8 (x86-64 Linux).\n\nStruct layout rules:\n1. Members are laid out **in declaration order** (the compiler may not reorder them).\n2. Padding is inserted before a member so it is aligned.\n3. The struct's alignment = the **max** member alignment, and `sizeof` is rounded up to a multiple of it (tail padding), so arrays of the struct stay aligned.\n\n**In class** (`sizeof` program):\n```cpp\nstruct Z      { int a; char b; };      // 4 + 1 + 3 pad          = 8\nstruct Person { int a; int b; };       // 4 + 4                  = 8\nstruct Any    { int a; char b[3]; };   // 4 + 3 + 1 pad          = 8\nstruct X      { char a; int* p; };     // 1 + 7 pad + 8          = 16\nstruct Y      { char a; int p; };      // 1 + 3 pad + 4          = 8\n```\nMore:\n```cpp\nstruct Bad  { char c; double d; char e; };   // 1+7+8+1+7 = 24\nstruct Good { double d; char c; char e; };   // 8+1+1+6   = 16  (sort big -> small)\nstruct alignas(64) Line { int x; };          // sizeof 64, alignof 64\n```\n\nWhy alignment matters:\n- Aligned loads are single accesses; a load that **straddles a cache-line boundary** costs two line accesses (and one straddling a page costs two TLB lookups). Misaligned atomics may not be atomic at all (split locks are extremely slow).\n- SIMD (AVX 32 B, AVX-512 64 B) prefers aligned data (`alignas(32)`, `std::aligned_alloc`).\n- Accessing an object through a misaligned pointer is **undefined behaviour** in C++ (e.g. `reinterpret_cast<int*>(buf + 1)`); use `std::memcpy` to read unaligned wire data.\n\n`#pragma pack(1)` / `__attribute__((packed))` removes padding (used to mirror exchange wire formats) at the cost of unaligned access. `offsetof(S, m)` gives a member's offset. Put hot fields together in the first cache line of a struct; cold fields after."
  },
  {
   "heading": "False sharing",
   "body": "**False sharing**: two threads write **different** variables that happen to sit on the **same 64-byte cache line**. Logically independent, but coherence works per line, so every write invalidates the other core's copy and the line ping-pongs (MESI M↔I) at ~50–100 ns a time. It can make a \"parallel\" program slower than single-threaded.\n\n```cpp\nstruct Counters { std::atomic<long> a; std::atomic<long> b; };   // 8 bytes apart: same line\n// thread 1: c.a++ in a loop, thread 2: c.b++ in a loop -> often 5-10x slower than padded\n\nstruct Padded {\n    alignas(64) std::atomic<long> a;   // own line\n    alignas(64) std::atomic<long> b;   // own line\n};                                     // sizeof(Padded) == 128\n// C++17: std::hardware_destructive_interference_size (usually 64) from <new>\n```\n\n- Fix: align/pad each independently-written variable to its own line (`alignas(64)`), use per-thread data combined at the end, or `thread_local`.\n- Some Intel CPUs prefetch adjacent line pairs, so 128-byte separation is sometimes used for the hottest variables.\n- Detect with `perf c2c` (reports **HITM**: loads that hit a line modified in another core's cache).\n- *True* sharing (both threads really need the same variable) cannot be padded away; reduce how often you write it.\n\n**In class:** the SPSC queue keeps the producer-owned `tail_` and consumer-owned `head_` on separate lines with `alignas(64)`; declared back-to-back they would be 8 bytes apart and every push/pop would steal the line from the other core (details in session 10)."
  },
  {
   "heading": "The hot path in HFT",
   "body": "The **hot path** is the code between \"market data packet arrives\" and \"order leaves the NIC\" (tick-to-trade). Targets are single-digit microseconds in software, sub-microsecond with FPGAs. Everything else (logging, risk reports, GUI, reconnects) is the **cold path** and runs on other threads.\n\nRules for the hot path:\n- **No syscalls, no blocking**: busy-poll on an isolated, pinned core; kernel-bypass network I/O.\n- **No dynamic allocation**: pools and pre-sized containers; no `std::string` growth, no `std::function` that allocates, no exceptions thrown.\n- **No locks**: lock-free SPSC queues between threads; each piece of state has a single writer.\n- **Cache-friendly data**: contiguous arrays, small structs, hot fields together, aligned, no false sharing; keep caches/TLB warm (huge pages, pre-faulted memory, run the path on dummy data when idle).\n- **Predictable branches**: error/rare checks marked `[[unlikely]]`, branchless where it helps, no virtual calls in tight loops (CRTP / templates instead).\n- **Compile-time work**: `constexpr` tables, templates, `-O3 -march=native`, LTO/PGO.\n- **Measure**: `rdtsc`/`steady_clock` timestamps, latency histograms (p50/p99/p99.9 and max), `perf`.\n\n| Event | Rough cost |\n|---|---|\n| L1 hit | ~1 ns |\n| Branch mispredict | ~5 ns |\n| L3 hit / uncontended atomic RMW | ~10–20 ns |\n| DRAM miss, cross-core cache-line transfer | ~60–100 ns |\n| `malloc` (fast path / slow path) | ~20 ns / µs |\n| Syscall / context switch | ~0.1–1 µs / 1–5 µs |\n| Minor page fault | ~1 µs |"
  },
  {
   "heading": "Quick revision",
   "body": "- System V args: `rdi, rsi, rdx, rcx, r8, r9`; return `rax`; callee-saved `rbx, rbp, r12–r15`; stack grows down, 16-byte aligned at calls.\n- Stack canary lives at `fs:0x28`; the VLA probe loop touches every 4 KiB page (stack-clash protection).\n- Cache line = 64 B. L1 ~1 ns, L2 ~4 ns, L3 ~10–20 ns, DRAM ~60–100 ns.\n- Sequential access + prefetcher = fast; pointer chasing = one possible DRAM miss per node.\n- Page = 4 KiB (12-bit offset); 4-level tables give 48-bit VA; huge pages 2 MiB / 1 GiB.\n- TLB caches translations; reach = entries × page size; a miss is a page walk.\n- First touch of a page = page fault (demand paging); pre-fault and `mlockall` in HFT.\n- Mispredict ≈ 15–20 cycles; a DRAM miss stalls ~300 cycles.\n- Syscall ~100 ns+, context switch µs; vDSO `clock_gettime` avoids the ring switch.\n- fd = index into the per-process fd table; 0/1/2 = stdin/stdout/stderr; lowest free number reused.\n- Sockets: `socket/bind/listen/accept` (server), `connect` (client); TCP for orders, UDP multicast for market data.\n- `epoll`: register once, O(ready) wait; edge-triggered needs non-blocking fds and read-until-EAGAIN.\n- MESI: writing a Shared line invalidates other copies; M line read by another core = HITM transfer.\n- glibc malloc: bins + arenas, `mmap` above 128 KiB; tcmalloc: per-thread/per-CPU size-class caches, no lock on the fast path.\n- Struct size = members + padding, rounded to the max alignment; order members big → small.\n- False sharing: independent writes to one line; fix with `alignas(64)` / `hardware_destructive_interference_size`.\n- Hot path: no alloc, no syscalls, no locks, warm cache, pinned core."
  },
  {
   "heading": "Exam traps",
   "body": "- **Coherence ≠ ordering**: MESI keeps each line consistent but does not stop the CPU/compiler reordering accesses to different addresses. You still need atomics/fences.\n- **False sharing has no shared variable**: the variables are different; the *line* is shared. Making them atomic does not help; padding does.\n- `sizeof(struct{char; int*;})` is **16**, not 9; `sizeof(struct{char; int;})` is 8; padding depends on order, and the compiler never reorders members for you.\n- `alignas(64)` on a struct makes `sizeof` a multiple of 64 too.\n- `malloc` returning a pointer does **not** mean physical memory is allocated; the page fault comes at first write.\n- Virtual addresses are per process: the same pointer value in two processes is unrelated memory.\n- `new[]` must be paired with `delete[]`; `delete` on an array is UB (seen in a class snippet).\n- `volatile` is not about threads or caches: it only stops the compiler from removing/merging accesses (useful for MMIO, the Lec-1 benchmark loop); it gives no atomicity or ordering.\n- `[[likely]]` is a layout hint, not a guarantee; branchless code can be slower than a well-predicted branch.\n- epoll is not \"zero syscalls\": `epoll_wait` itself is a syscall; kernel bypass is what removes them.\n- Edge-triggered epoll with a blocking fd, or without draining to `EAGAIN`, can hang.\n- tcmalloc is faster but not free: more memory use, size-class waste, occasional slow-path spikes. The HFT answer is \"don't allocate on the hot path\".\n- An unaligned `int` read through a cast pointer is UB even though x86 hardware tolerates it; use `memcpy`.\n- A VLA (`int arr[n]`) is a GCC extension, not ISO C++."
  }
 ],
 "keyTerms": [
  {
   "term": "Register",
   "def": "Storage inside the core (e.g. rax, rdi, rsp) accessed with no memory latency; all arithmetic operates on registers."
  },
  {
   "term": "Calling convention (System V AMD64)",
   "def": "Integer args in rdi, rsi, rdx, rcx, r8, r9; return in rax; rbx, rbp, r12-r15 are callee-saved."
  },
  {
   "term": "Stack canary",
   "def": "A random value (from fs:0x28) placed below the return address and checked before ret to detect stack buffer overflows."
  },
  {
   "term": "Cache line",
   "def": "The 64-byte unit in which data moves between memory and caches and in which coherence is tracked."
  },
  {
   "term": "Spatial / temporal locality",
   "def": "Using nearby addresses soon (spatial) and reusing the same addresses soon (temporal); both make caches effective."
  },
  {
   "term": "Virtual memory",
   "def": "Per-process address space translated to physical frames by the MMU using kernel-managed page tables."
  },
  {
   "term": "Page",
   "def": "Unit of virtual-to-physical mapping: 4 KiB by default, 2 MiB or 1 GiB for huge pages."
  },
  {
   "term": "TLB",
   "def": "Translation Lookaside Buffer: a small cache of virtual-to-physical page translations; a miss costs a page-table walk."
  },
  {
   "term": "Page fault",
   "def": "Trap into the kernel when a page is not mapped/present; minor faults map a frame (e.g. first touch), major faults read from disk."
  },
  {
   "term": "Branch misprediction",
   "def": "The predictor guessed a branch wrongly, so the pipeline flushes speculative work, costing about 15-20 cycles."
  },
  {
   "term": "Pipeline stall",
   "def": "A cycle in which pipeline stages cannot make progress, e.g. waiting on a cache miss, a dependency or a flush."
  },
  {
   "term": "System call",
   "def": "A controlled transition from user mode to the kernel (the syscall instruction) to request an OS service."
  },
  {
   "term": "Interrupt",
   "def": "A hardware or software signal that diverts a core to a kernel handler, adding latency jitter to the interrupted thread."
  },
  {
   "term": "File descriptor",
   "def": "Small integer indexing a process's kernel table of open files, sockets, pipes, epoll instances and so on."
  },
  {
   "term": "Socket",
   "def": "An fd representing a network endpoint (TCP stream or UDP datagram) used with send/recv."
  },
  {
   "term": "epoll",
   "def": "Linux I/O multiplexing API: register fds once, then epoll_wait returns only the ready ones (O(ready))."
  },
  {
   "term": "MESI",
   "def": "Cache-coherence protocol with states Modified, Exclusive, Shared, Invalid tracked per cache line."
  },
  {
   "term": "HITM",
   "def": "A load that hits a line held Modified in another core's cache, forcing a cross-core transfer; the signature of (false) sharing."
  },
  {
   "term": "tcmalloc",
   "def": "Google's thread-caching malloc: per-thread/per-CPU free lists per size class, so most allocations take no lock."
  },
  {
   "term": "Alignment",
   "def": "Requirement that an object's address be a multiple of alignof(T); drives padding in structs."
  },
  {
   "term": "Padding",
   "def": "Unused bytes the compiler inserts between or after struct members to satisfy alignment."
  },
  {
   "term": "False sharing",
   "def": "Different variables written by different cores share one cache line, causing coherence ping-pong."
  },
  {
   "term": "Hot path",
   "def": "The latency-critical code from market-data arrival to order send; kept free of allocation, syscalls and locks."
  },
  {
   "term": "Huge pages",
   "def": "2 MiB or 1 GiB pages that increase TLB reach and reduce TLB misses for large data."
  }
 ],
 "mcqs": [
  {
   "q": "On x86-64 Linux with GCC, what does this print?\n\n    struct X { char a; int* p; };\n    struct Y { char a; int p; };\n    std::cout << sizeof(X) << ' ' << sizeof(Y);",
   "options": [
    "16 8",
    "9 5",
    "16 5",
    "8 8"
   ],
   "answer": 0,
   "explanation": "A pointer has 8-byte alignment, so X gets 7 bytes of padding after `a` (1+7+8 = 16). An int has 4-byte alignment, so Y is 1+3+4 = 8. This is the class sizeof example.",
   "distractors": "9 and 5 ignore padding; 8 for X would put the pointer misaligned.",
   "source": "lecture",
   "id": "L08-m1"
  },
  {
   "q": "What is `sizeof(S)` on x86-64?\n\n    struct S { char c; double d; char e; };",
   "options": [
    "10",
    "24",
    "16",
    "32"
   ],
   "answer": 1,
   "explanation": "c (1) + 7 padding + d (8) + e (1) + 7 tail padding so the size is a multiple of alignof(double)=8: 24 bytes.",
   "distractors": "16 would require the compiler to reorder members, which it never does; reordering yourself to double, char, char gives 16.",
   "source": "lecture",
   "id": "L08-m2"
  },
  {
   "q": "In the System V AMD64 calling convention, which register holds the FIRST integer/pointer argument (e.g. `this` for a member function)?",
   "options": [
    "rax",
    "rsp",
    "rdi",
    "rcx"
   ],
   "answer": 2,
   "explanation": "Arguments go in rdi, rsi, rdx, rcx, r8, r9; `this` is the implicit first argument, so in the class objdump `lea rdi,[rip+...]` loaded the address of std::cin before calling operator>>.",
   "distractors": "rax is the return register, rcx is the 4th argument on Linux (it is the 1st on Windows x64), rsp is the stack pointer.",
   "source": "lecture",
   "id": "L08-m3"
  },
  {
   "q": "In the class objdump of `int N; cin >> N; int arr[N];`, what was the loop `sub rsp,0x1000; or QWORD PTR [rsp+0xff8],0` doing?",
   "options": [
    "Zero-initialising the array elements",
    "Checking the stack canary",
    "Spinning until cin has finished reading",
    "Moving the stack down one 4 KiB page at a time and touching each page so a large VLA cannot skip the guard page"
   ],
   "answer": 3,
   "explanation": "This is stack-clash protection: each 4 KiB step is probed with a harmless `or` so the guard page below the stack is always hit if the allocation is too big.",
   "distractors": "The array is not zeroed (`or ...,0` changes nothing), the canary check uses fs:0x28 at the end, and I/O is a call, not a loop.",
   "source": "lecture",
   "id": "L08-m4"
  },
  {
   "q": "A loop sums a 4096x4096 `int` matrix. Version A iterates `a[i][j]` with j innermost, version B with i innermost. Why is B typically several times slower?",
   "options": [
    "B causes more branch mispredictions",
    "B prevents the compiler from using registers",
    "B accesses memory with a 16 KiB stride, so nearly every access touches a new cache line and the prefetcher helps less",
    "B triggers a page fault on every access"
   ],
   "answer": 2,
   "explanation": "Row-major layout means A walks consecutive ints (one miss per 64-byte line = 16 ints); B jumps a whole row each time, so each access is a separate line and lines are evicted before reuse.",
   "distractors": "Both loops have identical, predictable branches; pages are already mapped after first touch, so there is no fault per access.",
   "source": "lecture",
   "id": "L08-m5"
  },
  {
   "q": "With 4 KiB pages, how many bits of a virtual address are the page offset, and how many page-table levels does standard x86-64 use for 48-bit addresses?",
   "options": [
    "12 bits, 4 levels",
    "16 bits, 3 levels",
    "12 bits, 2 levels",
    "20 bits, 4 levels"
   ],
   "answer": 0,
   "explanation": "4096 = 2^12, so 12 offset bits; the remaining 36 bits are split into four 9-bit indices (PML4, PDPT, PD, PT).",
   "distractors": "4 levels × 9 + 12 = 48 exactly; the other combinations do not add up to 48 bits.",
   "source": "lecture",
   "id": "L08-m6"
  },
  {
   "q": "An L1 dTLB has 64 entries. What is its reach with 4 KiB pages versus 2 MiB huge pages?",
   "options": [
    "64 KiB vs 64 MiB",
    "256 KiB vs 1 GiB",
    "4 MiB vs 128 MiB",
    "256 KiB vs 128 MiB"
   ],
   "answer": 3,
   "explanation": "Reach = entries × page size: 64 × 4 KiB = 256 KiB and 64 × 2 MiB = 128 MiB, which is why huge pages cut TLB misses for big order books and pools.",
   "distractors": "The other options multiply by the wrong page size.",
   "source": "lecture",
   "id": "L08-m7"
  },
  {
   "q": "A program calls `malloc(1 << 30)` and the call returns immediately. Which statement is true?",
   "options": [
    "1 GiB of physical RAM has been reserved and zeroed",
    "Only virtual address space is reserved; physical frames are assigned by page faults when each page is first touched",
    "The memory is on the stack",
    "The call must have failed because 1 GiB cannot be allocated that fast"
   ],
   "answer": 1,
   "explanation": "Large mallocs become mmap; Linux uses demand paging, so each 4 KiB page is backed (and zeroed) on first touch via a minor fault. HFT code pre-faults to avoid these faults later.",
   "distractors": "Nothing physical is allocated up front, and overcommit lets the call succeed quickly.",
   "source": "lecture",
   "id": "L08-m8"
  },
  {
   "q": "Roughly how much does one branch misprediction cost on a modern x86 core?",
   "options": [
    "~15-20 cycles",
    "~1 cycle",
    "~300 cycles",
    "~10,000 cycles"
   ],
   "answer": 0,
   "explanation": "The pipeline (about 14-20 stages) must be flushed and refetched from the correct target, so roughly 15-20 cycles, about 5 ns at 4 GHz.",
   "distractors": "~300 cycles is a DRAM miss; 10,000 cycles is syscall/context-switch territory.",
   "source": "lecture",
   "id": "L08-m9"
  },
  {
   "q": "Which of these is NOT a system call on Linux x86-64 in the usual glibc configuration?",
   "options": [
    "read",
    "clock_gettime",
    "epoll_wait",
    "accept"
   ],
   "answer": 1,
   "explanation": "clock_gettime is serviced by the vDSO, a kernel-provided page mapped into user space, so it runs without a ring switch (~20 ns).",
   "distractors": "read, epoll_wait and accept all execute the syscall instruction and enter the kernel.",
   "source": "lecture",
   "id": "L08-m10"
  },
  {
   "q": "A process starts, then runs:\n\n    int a = open(\"x.txt\", O_RDONLY);\n    int b = socket(AF_INET, SOCK_STREAM, 0);\n    close(a);\n    int c = open(\"y.txt\", O_RDONLY);\n\nAssuming only stdin/stdout/stderr were open at start, what are a, b, c?",
   "options": [
    "1, 2, 1",
    "3, 4, 5",
    "3, 4, 3",
    "0, 1, 2"
   ],
   "answer": 2,
   "explanation": "0, 1, 2 are taken; the kernel always returns the lowest free fd, so a = 3, b = 4, and after closing 3 the next open reuses 3.",
   "distractors": "Fds are reused, not ever-increasing; 0-2 are already in use.",
   "source": "lecture",
   "id": "L08-m11"
  },
  {
   "q": "Why is `epoll` preferred over `select`/`poll` for thousands of sockets?",
   "options": [
    "It copies all fd sets to the kernel faster",
    "It makes recv non-blocking automatically",
    "It avoids system calls entirely",
    "Fds are registered once, and epoll_wait returns only ready fds, so cost scales with ready fds rather than all watched fds"
   ],
   "answer": 3,
   "explanation": "select/poll pass and scan every fd on every call (O(n)); epoll keeps the interest list in the kernel and a ready list filled by callbacks.",
   "distractors": "epoll_wait is still a syscall, and it does not change the blocking mode of fds.",
   "source": "lecture",
   "id": "L08-m12"
  },
  {
   "q": "Core A holds a cache line in Shared state. Core A now writes to it. What happens under MESI?",
   "options": [
    "A writes silently and its copy stays Shared",
    "Every core updates its own copy with the new value",
    "A sends an invalidation (read-for-ownership); other copies become Invalid and A's copy becomes Modified",
    "The line is written to DRAM before A may write"
   ],
   "answer": 2,
   "explanation": "A Shared line may be in other caches, so A must invalidate them first; then A owns it in M. Only E or M lines can be written without a coherence message.",
   "distractors": "MESI is write-invalidate, not write-update, and it does not need a write to DRAM first.",
   "source": "lecture",
   "id": "L08-m13"
  },
  {
   "q": "Two threads increment `std::atomic<long> a` and `std::atomic<long> b` respectively, declared next to each other in one struct. The program scales badly. What is the most likely cause and fix?",
   "options": [
    "False sharing: both live in one 64-byte line; put each on its own line with alignas(64)",
    "Data race; make them atomic",
    "TLB misses; use huge pages",
    "Branch misprediction; use [[likely]]"
   ],
   "answer": 0,
   "explanation": "The variables are independent, but their shared cache line ping-pongs between cores on every write. Padding them to separate lines removes the coherence traffic.",
   "distractors": "They are already atomic, so there is no data race; TLB and branches are unaffected by this layout.",
   "source": "lecture",
   "id": "L08-m14"
  },
  {
   "q": "What is the main reason tcmalloc is faster than glibc malloc in heavily multithreaded programs?",
   "options": [
    "It returns memory from the stack",
    "It never frees memory",
    "It allocates with a syscall each time, which is faster",
    "Each thread (or CPU) has its own cache of free objects per size class, so the common path needs no lock"
   ],
   "answer": 3,
   "explanation": "The fast path is a pop from a thread-local (or per-CPU) free list; the central heap is touched only in batches, so contention disappears.",
   "distractors": "tcmalloc does free memory (back to central lists/page heap) and avoids syscalls on the fast path.",
   "source": "lecture",
   "id": "L08-m15"
  },
  {
   "q": "Which is the best practice for memory on an HFT hot path?",
   "options": [
    "Use tcmalloc so that new is cheap enough",
    "Pre-allocate pools at startup, pre-fault the pages, and do no heap allocation on the hot path",
    "Call malloc_trim after every order",
    "Use std::shared_ptr for every order to avoid leaks"
   ],
   "answer": 1,
   "explanation": "Even a fast allocator has unpredictable slow paths (refills, syscalls, page faults). Pools and pre-sized buffers give constant, nanosecond-scale cost.",
   "distractors": "shared_ptr adds allocation plus atomic refcounting; malloc_trim is a syscall-heavy cleanup.",
   "source": "lecture",
   "id": "L08-m16"
  },
  {
   "q": "What does this print on x86-64 (GCC)?\n\n    struct alignas(64) Slot { int x; };\n    std::cout << sizeof(Slot) << ' ' << alignof(Slot);",
   "options": [
    "64 64",
    "4 64",
    "4 4",
    "68 64"
   ],
   "answer": 0,
   "explanation": "alignas raises the alignment to 64, and sizeof must be a multiple of the alignment, so the struct is padded to 64 bytes.",
   "distractors": "sizeof can never be smaller than alignof for a complete object type used in arrays.",
   "source": "lecture",
   "id": "L08-m17"
  },
  {
   "q": "Which statement about `volatile` is correct in C++?",
   "options": [
    "It makes ++ atomic across threads",
    "It prevents the compiler from removing or merging the accesses, but gives no atomicity or inter-thread ordering",
    "It forces the variable to bypass the CPU cache",
    "It inserts a memory fence before each access"
   ],
   "answer": 1,
   "explanation": "volatile accesses are observable side effects that the compiler must perform (why the class benchmark used a volatile counter), but the data still sits in cache and races are still UB.",
   "distractors": "volatile does not bypass the cache, emit fences or make read-modify-write atomic; std::atomic does those jobs.",
   "source": "lecture",
   "id": "L08-m18"
  },
  {
   "q": "Why do low-latency systems prefer busy-polling a socket over a blocking `recv`?",
   "options": [
    "Blocking recv returns corrupted data",
    "Busy polling uses less CPU",
    "A blocking wait puts the thread to sleep; wake-up needs an interrupt, scheduler work and a context switch (microseconds), while a spinning thread on an isolated core reacts immediately",
    "Blocking recv only works for UDP"
   ],
   "answer": 2,
   "explanation": "Spinning burns a core but avoids the sleep/wake-up path and keeps caches warm; it is usually combined with core isolation and kernel bypass.",
   "distractors": "Busy polling uses 100% of a core, not less, and blocking recv works for both TCP and UDP.",
   "source": "lecture",
   "id": "L08-m19"
  },
  {
   "q": "Which registers must a function preserve (restore before returning) under the System V AMD64 ABI?",
   "options": [
    "rax, rcx, rdx",
    "rdi, rsi, rdx, rcx, r8, r9",
    "All general-purpose registers",
    "rbx, rbp, r12-r15"
   ],
   "answer": 3,
   "explanation": "rbx, rbp and r12-r15 are callee-saved; that is why the class objdump prologue pushed r15, r14, r13, r12 and rbx and popped them in reverse before ret.",
   "distractors": "The argument registers and rax/rcx/rdx are caller-saved scratch registers.",
   "source": "lecture",
   "id": "L08-m20"
  },
  {
   "q": "Which access pattern is most likely to be limited by DRAM latency rather than bandwidth?",
   "options": [
    "Summing a std::vector<int> front to back",
    "memcpy of a 1 GiB buffer",
    "Traversing a 10-million-node std::list that was built in random order",
    "Reading a 1 KiB std::array in a tight loop"
   ],
   "answer": 2,
   "explanation": "Each list node's address is only known after loading the previous node, so misses are serialized (pointer chasing) and the prefetcher cannot help: ~100 ns per node.",
   "distractors": "Sequential vector/memcpy streams are prefetched and bandwidth-bound; a 1 KiB array stays in L1.",
   "source": "lecture",
   "id": "L08-m21"
  },
  {
   "q": "What happens when a thread writes to an address on its stack's guard page (e.g. via runaway recursion)?",
   "options": [
    "The page fault cannot be satisfied, so the kernel delivers SIGSEGV",
    "The kernel silently grows the heap",
    "The write goes to a swap file",
    "Nothing; the guard page is ordinary memory"
   ],
   "answer": 0,
   "explanation": "The guard page is deliberately unmapped (or no-access); touching it faults and the kernel kills the process with a segmentation fault, which is how stack overflow is detected.",
   "distractors": "The heap and swap are unrelated; the guard page exists precisely to make the access fault.",
   "source": "lecture",
   "id": "L08-m22"
  },
  {
   "q": "Which change makes a well-predicted `if` in a hot loop SLOWER rather than faster?",
   "options": [
    "Marking it [[likely]] on the common path",
    "Sorting the input data",
    "Hoisting the condition out of the loop when it is loop-invariant",
    "Replacing it with a cmov-style branchless select that adds a long data dependency"
   ],
   "answer": 3,
   "explanation": "A predicted branch costs about nothing and lets the CPU speculate ahead; a cmov must wait for both inputs and the condition, lengthening the dependency chain.",
   "distractors": "[[likely]], sorting and hoisting either help or are neutral.",
   "source": "lecture",
   "id": "L08-m23"
  }
 ],
 "msqs": [
  {
   "q": "Which of the following are callee-saved registers in the System V AMD64 ABI? (select all that apply)",
   "options": [
    "rbx",
    "rdi",
    "r12",
    "rax",
    "rbp"
   ],
   "answers": [
    0,
    2,
    4
   ],
   "explanation": "rbx, rbp and r12-r15 must be preserved by the callee. rdi is the first argument register and rax the return register; both are caller-saved scratch.",
   "id": "L08-x1"
  },
  {
   "q": "Which statements about the cache line on x86-64 are true? (select all that apply)",
   "options": [
    "It is 64 bytes",
    "Coherence (MESI) is tracked per cache line",
    "Reading one int brings only those 4 bytes into L1",
    "Two variables on the same line written by different cores can cause false sharing"
   ],
   "answers": [
    0,
    1,
    3
   ],
   "explanation": "The line is the 64-byte unit of transfer and of coherence, so independent variables sharing it interfere. Loading one int always fetches the whole 64-byte line, so the third statement is false.",
   "id": "L08-x2"
  },
  {
   "q": "Which of the following typically cause a page fault? (select all that apply)",
   "options": [
    "First write to a page returned by a large malloc",
    "Dereferencing nullptr",
    "Reading an int that is already in L1 cache",
    "Writing to a copy-on-write page after fork",
    "A branch misprediction"
   ],
   "answers": [
    0,
    1,
    3
   ],
   "explanation": "First touch (demand paging), COW writes and accesses to unmapped page 0 all trap into the kernel. An L1 hit means the page is mapped and the TLB/caches already serve it; a mispredict is a pipeline event, not a memory fault.",
   "id": "L08-x3"
  },
  {
   "q": "Which techniques reduce TLB misses or page faults on an HFT hot path? (select all that apply)",
   "options": [
    "Using 2 MiB huge pages",
    "Pre-faulting memory at startup (touching every page or MAP_POPULATE)",
    "mlockall(MCL_CURRENT | MCL_FUTURE)",
    "Allocating each order with new on demand"
   ],
   "answers": [
    0,
    1,
    2
   ],
   "explanation": "Huge pages extend TLB reach, pre-faulting moves faults to startup and mlockall prevents pages being swapped out. Allocating on demand adds malloc cost and fresh page faults on the hot path.",
   "id": "L08-x4"
  },
  {
   "q": "Which of the following are system calls (they enter the kernel) on Linux? (select all that apply)",
   "options": [
    "epoll_wait",
    "send on a TCP socket",
    "clock_gettime via the vDSO",
    "std::atomic<int>::fetch_add",
    "mmap"
   ],
   "answers": [
    0,
    1,
    4
   ],
   "explanation": "epoll_wait, send and mmap execute the syscall instruction. The vDSO version of clock_gettime runs in user space, and fetch_add is a single lock xadd instruction with no kernel involvement.",
   "id": "L08-x5"
  },
  {
   "q": "Which statements about file descriptors are true? (select all that apply)",
   "options": [
    "They are small integers indexing a per-process kernel table",
    "A TCP server gets a new fd from accept() for every client connection",
    "A new fd always gets a number higher than any fd ever opened",
    "Sockets, pipes and epoll instances are all fds"
   ],
   "answers": [
    0,
    1,
    3
   ],
   "explanation": "An fd is an index into the fd table, accept returns a fresh connected socket fd, and 'everything is a file' covers sockets, pipes and epoll. The kernel reuses the lowest free number, so the third statement is false.",
   "id": "L08-x6"
  },
  {
   "q": "Which statements about epoll are true? (select all that apply)",
   "options": [
    "epoll_wait returns only fds that are ready",
    "Edge-triggered mode requires reading until EAGAIN, normally on non-blocking fds",
    "epoll eliminates all system calls from the receive path",
    "Fds are registered once with epoll_ctl rather than passed on every wait"
   ],
   "answers": [
    0,
    1,
    3
   ],
   "explanation": "epoll keeps an interest list and a ready list in the kernel, and edge-triggered mode only notifies on new arrivals. epoll_wait and recv are still syscalls; only kernel bypass removes them.",
   "id": "L08-x7"
  },
  {
   "q": "Under MESI, which states allow a core to write the line WITHOUT first sending a coherence message to other caches? (select all that apply)",
   "options": [
    "Modified",
    "Exclusive",
    "Shared",
    "Invalid"
   ],
   "answers": [
    0,
    1
   ],
   "explanation": "M and E mean this cache has the only copy, so a write is local (E silently becomes M). S may have other copies that must be invalidated, and I must first fetch the line with ownership.",
   "id": "L08-x8"
  },
  {
   "q": "Which of these struct definitions have sizeof == 8 on x86-64 GCC? (select all that apply)",
   "options": [
    "struct { int a; char b; }",
    "struct { char a; int* p; }",
    "struct { int a; char b[3]; }",
    "struct { char a; int p; }",
    "struct { char a; char b; }"
   ],
   "answers": [
    0,
    2,
    3
   ],
   "explanation": "From the class sizeof program: int+char = 4+1+3 pad = 8, int+char[3] = 4+3+1 = 8, char+int = 1+3+4 = 8. char+pointer is 1+7+8 = 16, and two chars are just 2 bytes.",
   "id": "L08-x9"
  },
  {
   "q": "Which are valid fixes for false sharing between two per-thread counters? (select all that apply)",
   "options": [
    "Declare each counter alignas(64) (or alignas(std::hardware_destructive_interference_size))",
    "Make both counters std::atomic",
    "Keep a local counter per thread and combine the totals at the end",
    "Add 56 bytes of padding between the counters"
   ],
   "answers": [
    0,
    2,
    3
   ],
   "explanation": "Aligning or padding puts the counters on separate lines, and thread-local accumulation avoids shared writes entirely. Making them atomic fixes data races, not false sharing: the line still ping-pongs.",
   "id": "L08-x10"
  },
  {
   "q": "Which statements about tcmalloc are true? (select all that apply)",
   "options": [
    "Small allocations are usually served from a thread-local or per-CPU free list without a lock",
    "It rounds requests up to size classes",
    "It guarantees constant-time, deterministic latency for every allocation",
    "It can use more memory than glibc malloc because caches hold idle objects"
   ],
   "answers": [
    0,
    1,
    3
   ],
   "explanation": "Thread/CPU caches per size class give a lock-free fast path at the cost of extra memory and rounding waste. Refills from the central heap and page heap still create occasional slow paths, so it is not deterministic.",
   "id": "L08-x11"
  },
  {
   "q": "Which belong on an HFT hot path? (select all that apply)",
   "options": [
    "Busy-polling a kernel-bypass receive ring on a pinned core",
    "Writing a log line with std::cout and std::endl",
    "Reading from a pre-allocated object pool",
    "Taking a std::mutex shared with the GUI thread",
    "Branch-light code with rare error checks marked [[unlikely]]"
   ],
   "answers": [
    0,
    2,
    4
   ],
   "explanation": "Spinning on bypassed I/O, pool allocation and predictable branches keep latency low. std::endl flushes (a write syscall), and a mutex shared with a slow thread can block for an unbounded time.",
   "id": "L08-x12"
  },
  {
   "q": "Which of the following stall the pipeline for many cycles? (select all that apply)",
   "options": [
    "A load that misses all caches and goes to DRAM",
    "A mispredicted branch",
    "A correctly predicted loop back-edge",
    "An mfence instruction",
    "An integer add whose operands are in registers"
   ],
   "answers": [
    0,
    1,
    3
   ],
   "explanation": "A DRAM miss (~300 cycles), a mispredict flush (~15-20 cycles) and a serializing fence all stall. A predicted branch and a register add cost about a cycle or less.",
   "id": "L08-x13"
  }
 ],
 "short": [
  {
   "q": "Explain virtual memory on x86-64: what a page and a page table are, how an address is translated, what the TLB does, and why huge pages help an HFT process.",
   "checks": [
    {
     "label": "Pages are 4 KiB (offset bits)",
     "patterns": [
      "4\\s*KiB",
      "4\\s*KB",
      "4096"
     ]
    },
    {
     "label": "Page tables map virtual to physical, multi-level walk",
     "patterns": [
      "page[- ]table",
      "page walk"
     ]
    },
    {
     "label": "TLB caches translations",
     "patterns": [
      "TLB"
     ]
    },
    {
     "label": "Huge pages increase TLB reach / fewer misses",
     "patterns": [
      "huge page",
      "2\\s*MiB",
      "2\\s*MB"
     ]
    },
    {
     "label": "Virtual vs physical address distinction",
     "patterns": [
      "physical"
     ]
    }
   ],
   "modelAnswer": "Each process has its own virtual address space. Memory is mapped in pages of 4 KiB (low 12 bits = offset). The kernel keeps a 4-level page table (PML4 -> PDPT -> PD -> PT, 9 index bits each, 48-bit addresses) that maps each virtual page number to a physical frame plus permission bits. On every access the MMU must translate virtual -> physical; doing a full page walk costs 4 dependent memory reads, so the CPU caches recent translations in the TLB (about 64 L1 entries, ~1.5K L2 entries). A TLB miss triggers a page walk (tens to hundreds of cycles). Pages that are not present cause a page fault (e.g. on first touch, demand paging). TLB reach = entries x page size: 64 x 4 KiB = 256 KiB, but with 2 MiB huge pages it is 128 MiB, so a large order book or memory pool stops missing the TLB. HFT processes also pre-fault and mlock their memory so no page faults happen on the hot path.",
   "explanation": "The examiner wants page size, the page-table translation, the TLB as a cache of translations, and huge pages increasing TLB reach.",
   "id": "L08-s1"
  },
  {
   "q": "Find the problem and fix it (two threads, each runs for 10^8 iterations):\n\n    struct Stats { std::atomic<long> hits; std::atomic<long> misses; } st;\n    // thread 1: st.hits.fetch_add(1, std::memory_order_relaxed);\n    // thread 2: st.misses.fetch_add(1, std::memory_order_relaxed);",
   "checks": [
    {
     "label": "Identifies false sharing",
     "patterns": [
      "false sharing"
     ]
    },
    {
     "label": "Same cache line / 64 bytes",
     "patterns": [
      "cache line",
      "64"
     ]
    },
    {
     "label": "Coherence ping-pong / invalidation",
     "patterns": [
      "MESI",
      "invalidat",
      "ping"
     ]
    },
    {
     "label": "Fix with alignas(64) or padding / interference size",
     "patterns": [
      "alignas",
      "pad",
      "hardware_destructive_interference_size"
     ]
    }
   ],
   "modelAnswer": "The code is correct (no data race, both are atomic) but slow because of false sharing: hits and misses are 8 bytes apart, so they live on the same 64-byte cache line. Every fetch_add needs the line in Modified state, so under MESI each write invalidates the other core's copy and the line ping-pongs between the cores (~50-100 ns per transfer). Fix: put each counter on its own cache line:\n\nstruct Stats {\n    alignas(64) std::atomic<long> hits;\n    alignas(64) std::atomic<long> misses;\n};   // or alignas(std::hardware_destructive_interference_size)\n\nEven better, keep a plain per-thread counter and combine at the end.",
   "explanation": "Key points: the bug is performance, not correctness; same line; coherence invalidation; padding/alignment fix.",
   "id": "L08-s2"
  },
  {
   "q": "Predict the size on x86-64 and rewrite the struct to be as small as possible without removing members:\n\n    struct Order { char side; double price; int qty; char type; long id; };",
   "checks": [
    {
     "label": "Original size 32",
     "patterns": [
      "\\b32\\b"
     ]
    },
    {
     "label": "Reordered size 24",
     "patterns": [
      "\\b24\\b"
     ]
    },
    {
     "label": "Explains padding/alignment",
     "patterns": [
      "pad",
      "align"
     ]
    },
    {
     "label": "Orders members large to small",
     "patterns": [
      "large",
      "big",
      "descending",
      "largest"
     ]
    }
   ],
   "modelAnswer": "Original layout: side at offset 0, then 7 bytes of padding so price (alignment 8) starts at 8; price 8-15; qty 16-19; type at 20, then 3 bytes of padding so id starts at 24; id 24-31. sizeof(Order) = 32 (already a multiple of the struct alignment 8, so no tail padding).\n\nReorder from largest to smallest alignment to remove the internal padding:\n\nstruct Order { double price; long id; int qty; char side; char type; };\n// 8 + 8 + 4 + 1 + 1 = 22 bytes of data, rounded up to a multiple of 8 = 24\n\nSo 32 -> 24 bytes. Padding exists because each member must sit at a multiple of its alignment and sizeof is rounded up to the largest member alignment so arrays stay aligned. The compiler never reorders members itself.",
   "explanation": "Sorting members by descending alignment minimises padding; the size rounds up to the largest alignment.",
   "id": "L08-s3"
  },
  {
   "q": "Compare glibc malloc and tcmalloc: how each serves a small allocation, why tcmalloc was created, and what its costs are. What do HFT systems do instead?",
   "checks": [
    {
     "label": "glibc arenas/bins/locks",
     "patterns": [
      "arena",
      "bin",
      "lock"
     ]
    },
    {
     "label": "tcmalloc per-thread or per-CPU cache",
     "patterns": [
      "thread[- ]?(local|cache)",
      "per[- ](thread|cpu)"
     ]
    },
    {
     "label": "Size classes",
     "patterns": [
      "size class"
     ]
    },
    {
     "label": "Costs: memory overhead / spikes",
     "patterns": [
      "memory (overhead|usage)",
      "more memory",
      "spike",
      "slow path"
     ]
    },
    {
     "label": "HFT: pools / pre-allocate / no allocation on hot path",
     "patterns": [
      "pool",
      "pre-?allocat"
     ]
    }
   ],
   "modelAnswer": "glibc malloc (ptmalloc2) keeps free chunks in bins inside arenas; small requests are taken from a per-thread tcache or the arena's bins, which may require the arena lock; large requests (>= 128 KiB) go straight to mmap. Under many threads the arena locks contend, chunks fragment, and the slow path can do brk/mmap syscalls and page faults.\n\ntcmalloc (thread-caching malloc) was built for multithreaded servers: every thread (newer versions: every CPU) has its own free list for each size class, so the fast path is a lock-free pop, ~10-20 ns. Central free lists and a page heap refill or drain these caches in batches. Benefits: no lock on the fast path, less contention, less fragmentation. Costs: more memory overhead because each thread cache holds idle memory, internal waste from rounding up to a size class, and occasional slow path spikes when a cache must be refilled or released, so latency is still not deterministic.\n\nHFT systems therefore pre-allocate everything at startup (object pools with free lists, ring buffers, reserved vectors, arenas), pre-fault the pages, and do no allocation at all on the hot path.",
   "explanation": "Mention the data structures (bins/arenas vs per-thread size-class caches), why (contention), trade-offs, and pools.",
   "id": "L08-s4"
  },
  {
   "q": "List the costs of a blocking `recv()` on a TCP socket compared with a kernel-bypass busy-poll loop, and explain what a file descriptor is in this picture.",
   "checks": [
    {
     "label": "fd = index into per-process kernel table",
     "patterns": [
      "index",
      "table"
     ]
    },
    {
     "label": "Syscall / mode switch cost",
     "patterns": [
      "syscall",
      "system call",
      "kernel mode",
      "ring"
     ]
    },
    {
     "label": "Sleep / context switch / wake-up",
     "patterns": [
      "context switch",
      "sleep",
      "wake"
     ]
    },
    {
     "label": "Copy from kernel to user space / headers",
     "patterns": [
      "copy",
      "header"
     ]
    },
    {
     "label": "Bypass spins in user space on an isolated core",
     "patterns": [
      "bypass",
      "busy[- ]?poll",
      "spin"
     ]
    }
   ],
   "modelAnswer": "A file descriptor is a small integer that is an index into the process's fd table in the kernel; the entry points to the kernel's socket object, so all socket I/O must go through system calls on that number.\n\nBlocking recv(fd, ...): (1) the syscall instruction switches to kernel mode (~100 ns+, more with KPTI); (2) if no data is ready, the thread is put to sleep and the core runs something else; (3) when the packet arrives the NIC raises an interrupt, the kernel's TCP/IP stack processes and strips the IP and TCP headers, (4) wakes the thread, which requires a scheduler decision and a context switch (1-5 µs, cold caches afterwards); (5) the payload is copied from kernel buffers into the user buffer. Total: several microseconds with jitter.\n\nKernel-bypass busy-poll: the NIC DMA-writes packets into a ring buffer mapped into user space; a thread pinned to an isolated core spins checking that ring, so there is no syscall, no interrupt, no sleep/wake-up and no extra copy; reaction time is in the hundreds of nanoseconds, at the price of burning a whole core.",
   "explanation": "Expected: what an fd is, the syscall and context-switch costs, the copy, and how bypass removes them.",
   "id": "L08-s5"
  },
  {
   "q": "Walk through the MESI states of one cache line when core 0 reads X, core 1 reads X, core 1 writes X, then core 0 reads X again. Why does this matter for a shared counter?",
   "checks": [
    {
     "label": "First read Exclusive",
     "patterns": [
      "exclusive",
      "\\bE\\b"
     ]
    },
    {
     "label": "Both Shared",
     "patterns": [
      "shared",
      "\\bS\\b"
     ]
    },
    {
     "label": "Write invalidates other / Modified",
     "patterns": [
      "invalid",
      "modified"
     ]
    },
    {
     "label": "Cross-core transfer cost / ping-pong for counter",
     "patterns": [
      "ping",
      "transfer",
      "bounce",
      "ns"
     ]
    }
   ],
   "modelAnswer": "1. Core 0 reads X: no other cache has it, so core 0 holds it Exclusive (E).\n2. Core 1 reads X: core 0 sees the snoop; both copies become Shared (S).\n3. Core 1 writes X: it must send an invalidate / read-for-ownership; core 0's copy goes to Invalid (I) and core 1's to Modified (M).\n4. Core 0 reads X again: miss; core 1 holds it M, so it supplies the data (a HITM) and writes it back; both become Shared (S).\n\nFor a counter that several cores increment, every increment needs the line in M on the incrementing core, so the line keeps bouncing (ping-pong) between cores, each transfer costing ~50-100 ns. That is why a contended atomic counter or false sharing caps throughput; per-thread counters avoid it.",
   "explanation": "Correct state sequence E, S, I/M, S and the cross-core transfer cost.",
   "id": "L08-s6"
  }
 ],
 "quiz": [],
 "coding": [],
 "prev": {
  "num": 7,
  "file": "lecture-07.html"
 },
 "next": {
  "num": 9,
  "file": "lecture-09.html"
 }
};
