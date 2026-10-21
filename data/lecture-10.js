window.PAGE = {
 "num": 10,
 "title": "Atomics and Concurrency 2",
 "summary": "Lock-free programming with std::atomic: what atomic operations compile to, the C++ memory model (happens-before, synchronizes-with), and the memory orders relaxed, acquire, release, acq_rel and seq_cst. Then compare_exchange and the ABA problem, lock-free vs wait-free, the class lock-free stack (with its bugs fixed) and the SPSC ring buffer from Lec-10/11/12: power-of-2 masking, release/acquire indices, cache-line padding of head and tail, and how to benchmark it.",
 "notes": [
  {
   "heading": "std::atomic: indivisible operations without a lock",
   "body": "`std::atomic<T>` makes every operation on the object **indivisible** (no other thread sees a half-done update) and **race-free** (concurrent access is defined behaviour).\n\n```cpp\n#include <atomic>\nstd::atomic<long> counter{0};\ncounter.fetch_add(1);              // returns the OLD value; same as counter++\ncounter += 5;                      // also atomic\nlong v = counter.load();           // atomic read\ncounter.store(0);                  // atomic write\nlong old = counter.exchange(42);   // write, return previous\nbool ok = counter.compare_exchange_strong(old, old + 1);   // CAS\ncounter.is_lock_free();            // true for 1/2/4/8-byte types on x86-64\n```\n- Works for integral types, pointers, `bool`, floating point (C++20 adds `fetch_add` for floats), and any **trivially copyable** `T` (large ones may use a hidden lock: check `is_lock_free()` / `is_always_lock_free`).\n- Not copyable or movable. `x = x + 1` on an atomic is **two** atomic operations (load, then store): not an atomic increment. Use `fetch_add` / `++x`.\n- `std::atomic_ref<T>` (C++20) performs atomic operations on a non-atomic object.\n\nWhat it compiles to on x86-64:\n| C++ | x86-64 | Cost (uncontended) |\n|---|---|---|\n| `load` (any order) | plain `mov` | ~1 ns (cache hit) |\n| `store` relaxed/release | plain `mov` | ~1 ns |\n| `store` seq_cst | `xchg` (implicit lock) or `mov`+`mfence` | ~10–20 ns |\n| `fetch_add`, `exchange` | `lock xadd`, `xchg` | ~5–20 ns |\n| `compare_exchange` | `lock cmpxchg` | ~5–20 ns |\n| any RMW on a line another core is writing | + cache-line transfer | ~50–100+ ns |\n\nAtomics are not free: a contended atomic counter shared by many cores is a scalability bottleneck because the line ping-pongs (MESI, session 8)."
  },
  {
   "heading": "The memory model: reordering, happens-before and visibility",
   "body": "Both the **compiler** and the **CPU** reorder memory operations when a single thread cannot tell the difference: the compiler schedules instructions and keeps values in registers; the CPU executes out of order, and its **store buffer** lets later loads complete before earlier stores become visible to other cores (x86 allows store→load reordering; ARM/POWER allow almost any reordering).\n\n**In class** we used this example: thread 1 writes `x = 1; y = 5; z = 2;` and thread 2 does `while (y != 5) {} print(z);`. Without atomics, thread 2 may print **0**: the write to `z` may become visible before or after `y`, the compiler may hoist the read of `y` out of the loop, and the whole program is a data race. Similarly with an array: `arr[3] = 15; arr[900] = 10; arr[5] = 20;` in thread 1 and `while (arr[900] != 10) {} print(arr[3], arr[5]);` in thread 2 can print `15 0`, or even `0 0`.\n\nThe C++ memory model gives you guarantees through relations:\n- **sequenced-before**: order within one thread.\n- **synchronizes-with**: a **release** store (or unlock) to atomic `A`, read by an **acquire** load (or lock) of `A` that **sees that value**.\n- **happens-before**: built from the two above (transitive). If write W happens-before read R, R sees W (or something later).\n\nThe rule the instructor phrased as: for a release store, \"all updates above me must not move down\"; for an acquire load, \"all updates below me must not move up\". Those two half-barriers are enough to publish data from one thread to another."
  },
  {
   "heading": "Memory orders: relaxed, acquire, release, acq_rel, seq_cst",
   "body": "| Order | Guarantees | Typical use | x86 cost |\n|---|---|---|---|\n| `memory_order_relaxed` | atomicity + a single modification order per variable; **no ordering** of other memory | counters, statistics, a thread's own index | same as plain |\n| `memory_order_acquire` (loads) | no later read/write in this thread may move **before** it | reading a flag/index before reading the data it guards | free (`mov`) |\n| `memory_order_release` (stores) | no earlier read/write may move **after** it | publishing data, then setting the flag/index | free (`mov`) |\n| `memory_order_acq_rel` (RMW) | both | CAS / fetch_add that both consumes and publishes | `lock` instr |\n| `memory_order_seq_cst` (default) | acquire/release + one **single total order** of all seq_cst ops seen by every thread | default; when reasoning needs global order (e.g. Dekker/Peterson) | store = `xchg`/`mfence` |\n| `memory_order_consume` | dependency-ordered acquire | discouraged; compilers treat it as acquire | |\n\nRules:\n- Acquire is for **loads**, release for **stores**; passing `release` to `load` is undefined behaviour per the standard and GCC warns about it (and `compare_exchange`'s failure order cannot be release/acq_rel).\n- Release/acquire **pair** only on the **same atomic variable**, when the acquire load reads the value written by the release store (or a later RMW in its release sequence).\n- x86 is **TSO** (total store order): ordinary loads are already acquire, ordinary stores already release; only store→load reordering is possible, which only `seq_cst` (or `mfence`) forbids. So on x86 relaxed vs acquire/release mostly affects the **compiler**; on ARM they emit different instructions (`ldar`/`stlr` vs `ldr`/`str`, or `dmb` barriers).\n- Fences: `std::atomic_thread_fence(order)` orders surrounding relaxed operations.\n\n```cpp\n// The classic store-buffer litmus test\nstd::atomic<int> x{0}, y{0}; int r1, r2;\n// T1: x.store(1, R); r1 = y.load(R);\n// T2: y.store(1, R); r2 = x.load(R);\n// With R = relaxed or acquire/release: r1 == 0 && r2 == 0 is POSSIBLE (even on x86).\n// With seq_cst everywhere: impossible.\n```"
  },
  {
   "heading": "Release/acquire message passing",
   "body": "The pattern every lock-free queue is built on: write the data with ordinary stores, then **release**-store a flag/index; the reader **acquire**-loads the flag/index and only then reads the data.\n\n```cpp\nint payload;                          // plain, non-atomic\nstd::atomic<bool> ready{false};\n\nvoid producer() {\n    payload = 42;                                     // (1)\n    ready.store(true, std::memory_order_release);     // (2) (1) cannot move below this\n}\nvoid consumer() {\n    while (!ready.load(std::memory_order_acquire)) {} // (3) reads below cannot move above\n    assert(payload == 42);                            // (4) guaranteed\n}\n```\n(2) synchronizes-with (3) once (3) reads `true`, so (1) happens-before (4): no data race on `payload`, and the assert holds. With `relaxed` on both, the assert can fail (on ARM in practice; on x86 the compiler may still reorder).\n\nRelaxed is correct when you need only atomicity:\n```cpp\nstd::atomic<uint64_t> msgs{0};\nmsgs.fetch_add(1, std::memory_order_relaxed);   // stats counter; read after join()\n```\n`thread.join()` also synchronizes, so a relaxed counter read after joining sees the final total."
  },
  {
   "heading": "compare_exchange (CAS): weak vs strong",
   "body": "`a.compare_exchange_strong(expected, desired)` does atomically:\n```cpp\nif (a == expected) { a = desired; return true; }\nelse               { expected = a; return false; }   // expected is UPDATED with the current value\n```\n(**In class** we wrote it as `A.compare(B, C)`: if A == B then A = C, else B = A.) On x86 it is one `lock cmpxchg`.\n\n- `compare_exchange_weak` may **fail spuriously** (return false even when equal) on LL/SC machines (ARM, POWER); in exchange it is cheaper there. Use **weak in a loop**, strong when a single attempt decides something.\n- The standard CAS loop: since a failure refreshes `expected`, you just recompute and retry:\n```cpp\n// atomic max\nvoid update_max(std::atomic<int>& m, int v) {\n    int cur = m.load(std::memory_order_relaxed);\n    while (cur < v && !m.compare_exchange_weak(cur, v,\n               std::memory_order_relaxed, std::memory_order_relaxed)) {\n        // cur now holds the latest value; loop re-checks cur < v\n    }\n}\n```\n- Two-order overload: `(expected, desired, success_order, failure_order)`; the failure order cannot be `release` or `acq_rel`.\n- CAS compares **bytes** (object representation): beware padding in structs and `-0.0`/NaN for floats.\n- Under contention CAS loops can retry many times (each failure is a cache-line transfer): lock-free does not mean fast under heavy contention."
  },
  {
   "heading": "The ABA problem",
   "body": "CAS checks \"is the value still the one I read?\", not \"has nothing happened?\". **ABA**: a thread reads A, gets preempted; other threads change it to B and back to A (often: pop node A, free it, allocate a new node at the **same address**, push it); the first thread's CAS succeeds although the structure changed, corrupting it.\n\nLock-free stack example (head → A → B → C):\n1. T1 in `pop`: reads `old = A`, `next = A->next = B`, then is preempted.\n2. T2 pops A, pops B (frees B), pushes a new node that `new` places at A's old address.\n   Stack is now head → A' (same address as A) → C.\n3. T1 resumes: `CAS(head, A, B)` succeeds because head still equals A, so head = **B**, a freed node. Corruption / use-after-free.\n\nFixes:\n- **Tagged (versioned) pointers**: pair the pointer with a counter incremented on every change and CAS both (16-byte `cmpxchg16b`, or pack a tag into unused upper pointer bits).\n- **Safe memory reclamation**: **hazard pointers** (threads publish pointers they are about to dereference; nodes are freed only when no hazard points at them), **epoch-based reclamation / RCU**, or reference counting.\n- **Never free / reuse nodes** during the run (pools that do not recycle while readers exist), common in HFT.\n- Use data structures without the problem: an **SPSC ring buffer** has one writer per index, so no CAS and no ABA."
  },
  {
   "heading": "Lock-free vs wait-free vs blocking",
   "body": "Progress guarantees (strongest last):\n| Class | Guarantee | Example |\n|---|---|---|\n| **Blocking** | a thread holding a lock can stop everyone (preempted, crashed) | std::mutex queue |\n| **Obstruction-free** | a thread running alone finishes in finite steps | some STM designs |\n| **Lock-free** | at every moment **some** thread makes progress; a CAS fails only because another succeeded; individual threads can starve | Treiber stack, Michael-Scott queue |\n| **Wait-free** | **every** thread finishes each operation in a **bounded** number of its own steps | SPSC ring buffer push/pop (return false if full/empty), `fetch_add` on x86 |\n\n- \"Lock-free\" is about **progress**, not speed: a lock-free CAS loop under heavy contention can be slower than a good mutex. Its real benefit for HFT is **no blocking**: a preempted thread cannot stall the others, and there are no syscalls.\n- A spinlock is not lock-free (if the holder is preempted, nobody progresses).\n- `std::atomic<T>::is_lock_free()` means \"implemented without a lock\", a hardware property, different from an algorithm being lock-free."
  },
  {
   "heading": "The lock-free stack from class (Treiber stack)",
   "body": "**In class (Lec-12)** we wrote a stack where many threads can push and pop, keeping `std::atomic<Node*> head`. The class draft had bugs worth knowing for the exam:\n```cpp\n// class draft (simplified)\nbool push(T val) {\n    Node* newNode = new Node(val, head);\n    while (head.compare_exchange_weak(newNode->next, newNode)) {}   // BUG: loop condition inverted\n}\nbool pop(T& val) {\n    auto current = head;\n    while (head.compare_exchange_weak(current, head->next)) {}        // BUG: inverted, re-reads head, ABA\n    current.~T();                                                     // BUG: destroys a pointer as T\n}\n```\n1. The loop must retry **while CAS fails**: `while (!head.compare_exchange_weak(...))`. As written it loops while it *succeeds*.\n2. `pop` must compute `next` from `current`, not re-read `head`; and must handle the empty stack (`current == nullptr`).\n3. Neither function returns a value (UB for a non-void function), and the node must be deleted, not `~T()` called on a pointer.\n4. Freeing the popped node is unsafe without reclamation: another thread may be reading `current->next` (use-after-free, ABA).\n\nCorrected version:\n```cpp\ntemplate <typename T>\nclass LockFreeStack {\n    struct Node { T val; Node* next; };\n    std::atomic<Node*> head_{nullptr};\npublic:\n    void push(T v) {\n        Node* n = new Node{std::move(v), head_.load(std::memory_order_relaxed)};\n        // on failure, n->next is refreshed with the current head; just retry\n        while (!head_.compare_exchange_weak(n->next, n,\n                   std::memory_order_release, std::memory_order_relaxed)) {}\n    }\n    bool pop(T& out) {\n        Node* old = head_.load(std::memory_order_acquire);\n        while (old && !head_.compare_exchange_weak(old, old->next,\n                   std::memory_order_acquire, std::memory_order_acquire)) {}\n        if (!old) return false;            // empty\n        out = std::move(old->val);\n        // delete old;  <- only safe with hazard pointers / epochs; otherwise leak or pool it\n        return true;\n    }\n};\n```\n- Release in `push` publishes the node's contents; acquire in `pop` makes them visible before reading `old->val` / `old->next`.\n- This is **lock-free** (some CAS always wins) but not wait-free, and the single `head` is a contention hotspot.\n- Using `new` in `push` is itself a hidden lock/syscall risk on the hot path; real systems pre-allocate nodes.\n\n**In class (Lec-11)** an earlier attempt used an array with `atomic<size_t> pushIdx` but did `arr[mPushIdx] = val; mPushIdx++;` as separate steps: two pushers can claim the same slot. Reserving a slot must be one atomic RMW (`fetch_add` or CAS), and even then the reader cannot know when the slot's data is written, which is why the multi-producer case is hard."
  },
  {
   "heading": "The SPSC ring buffer: design ideas from class",
   "body": "**SPSC** = single producer, single consumer: exactly one thread pushes (market-data listener) and exactly one pops (strategy). Because each index has **one writer**, no CAS or lock is needed: only loads/stores with acquire/release.\n\nIdeas listed **in class (Lec-10)**:\n1. **Memory-order optimisations**: each thread reads its *own* index relaxed and the *other's* with acquire; publishes its own with release.\n2. **Power-of-2 capacity**: replace `idx % size` (a `div`, 20–40 cycles) with `idx & (size - 1)` (1 cycle). Example from class: size 8 = `1000b`, mask `0111b`; `6 & 7 = 6`, `8 & 7 = 0`.\n3. **`[[unlikely]]`** on the full/empty checks to keep the common path straight-line (avoid pipeline stalls).\n4. **Ever-increasing indices**: never wrap `head`/`tail`; `size = tail - head`, `full: tail - head == capacity`, `empty: tail == head`. With unsigned 64-bit `size_t` the subtraction is correct even after wrap-around (modulo 2^64), and with a power-of-2 capacity `idx & mask` stays continuous across the wrap. (The class \"2^32\" question: with 32-bit indices and a non-power-of-2 size, `%` breaks at the wrap; with 64-bit indices it would take ~584 years at 1 op/ns to wrap.) It also avoids the \"one empty slot\" trick needed when indices wrap at capacity.\n5. **Avoid extra copies in pop**: `bool pop(T& out)` writes into the caller's object (or returns a pointer to the slot / uses a `front()`+`pop()` pair) instead of returning by value.\n6. **Raw storage**: `::operator new(sizeof(T) * size)` allocates memory without constructing `T`s; push must then **construct in place** with placement `new (&slot) T(val)` and pop must call `~T()`. **In class (Lec-10 code.cpp)** we saw that `X* arr = (X*)::operator new(10 * sizeof(X)); arr[0] = X{1};` assigns to an object that was never constructed: fine for trivial types in practice, UB for types with real invariants (e.g. `std::string`). Free with `::operator delete`, not `delete`.\n7. **Pad the indices** to separate cache lines (`alignas(64)`), next section.\n\nBugs to notice in the class draft `spsc_queue.h`: memory orders were swapped (`increment(acquire)` on the publishing write and `load(release)` on the reading side; it must be **release on the store, acquire on the load**), `%` instead of the mask, `delete mData` on memory from `::operator new` (must be `::operator delete`, after destroying live elements), and the copy-assignment declaration was mistyped."
  },
  {
   "heading": "The SPSC queue implementation (Lec-12)",
   "body": "**In class (Lec-12 `spsc_queue.hpp`)** the final version:\n```cpp\ntemplate <typename T, std::size_t Capacity>\nclass SPSCQueue {\n    static_assert((Capacity & (Capacity - 1)) == 0, \"Capacity must be a power of 2\");\n    static constexpr std::size_t kMask = Capacity - 1;\n    alignas(64) std::atomic<std::size_t> tail_{0};   // written ONLY by producer\n    alignas(64) std::atomic<std::size_t> head_{0};   // written ONLY by consumer\n    alignas(64) std::array<T, Capacity> slots_;\npublic:\n    bool push(const T& v) {                                     // producer only\n        const std::size_t t = tail_.load(std::memory_order_relaxed);   // own index\n        if (t - head_.load(std::memory_order_acquire) == Capacity)      // full?\n            return false;\n        slots_[t & kMask] = v;                        // plain write: slot is mine\n        tail_.store(t + 1, std::memory_order_release);   // publish the slot\n        return true;\n    }\n    bool pop(T& out) {                                          // consumer only\n        const std::size_t h = head_.load(std::memory_order_relaxed);   // own index\n        if (h == tail_.load(std::memory_order_acquire))                 // empty?\n            return false;\n        out = slots_[h & kMask];\n        head_.store(h + 1, std::memory_order_release);   // give the slot back\n        return true;\n    }\n};\n```\nWhy each order is correct:\n- `tail_.store(release)` in push pairs with `tail_.load(acquire)` in pop: the consumer that sees the new tail also sees the slot contents written before it.\n- `head_.store(release)` in pop pairs with `head_.load(acquire)` in push: the producer only overwrites a slot after the consumer has finished reading it.\n- Each thread reads its **own** index `relaxed`: no other thread writes it, so it always sees its own last value.\n- push/pop are **wait-free**: a bounded number of steps, returning `false` instead of waiting.\n- `std::array<T, N>` default-constructs all slots up front (T must be default-constructible and copy-assignable); raw storage + placement new removes that requirement.\n\nUse: `while (!q.push(x)) {}` in the producer (spin when full) and `if (q.pop(v)) …` in the consumer's busy loop."
  },
  {
   "heading": "Cache-line padding of head and tail (false sharing)",
   "body": "The producer writes `tail_` on every push and the consumer writes `head_` on every pop. If they are declared back-to-back they are **8 bytes apart, on the same 64-byte line**: every operation of one thread invalidates the other's copy (MESI M→I), and the line ping-pongs: **false sharing**. **In class** the Lec-12 header describes exactly this \"planted bug\" (the naive layout), which `perf c2c` shows as heavy **HITM** traffic; the `alignas(64)` on each member is the fix, and the lab helper `index_gap_bytes()` prints 8 for the naive layout and 64 for the padded one.\n\n```cpp\n// naive: 8 bytes apart -> same line\nstd::atomic<size_t> tail_{0};\nstd::atomic<size_t> head_{0};\n// fixed: one line each, and the slots start on their own line too\nalignas(64) std::atomic<size_t> tail_{0};\nalignas(64) std::atomic<size_t> head_{0};\nalignas(64) std::array<T, N> slots_;\n```\nPadding typically gives a **2–5x** throughput gain on this benchmark.\n\nNext optimisation (Rigtorp / Folly style **cached indices**): the producer keeps a private copy `headCache_` of the consumer's index and only re-reads the real `head_` (a cross-core miss) when the cache says the queue looks full; the consumer does the same with `tailCache_`. Each shared line is then touched only occasionally, giving another large gain.\n```cpp\nbool push(const T& v) {\n    size_t t = tail_.load(std::memory_order_relaxed);\n    if (t - headCache_ == Capacity) {                    // looks full: refresh\n        headCache_ = head_.load(std::memory_order_acquire);\n        if (t - headCache_ == Capacity) return false;\n    }\n    slots_[t & kMask] = v;\n    tail_.store(t + 1, std::memory_order_release);\n    return true;\n}\n```\nAlso keep `sizeof(T)` slots from sharing a line with frequently written neighbours, and use `std::hardware_destructive_interference_size` (C++17) instead of a hard-coded 64 where available."
  },
  {
   "heading": "Benchmarking concurrent code",
   "body": "**In class (Lec-12 `main.cpp`)**: a producer thread pushes `N = 10'000'000` `uint64_t`s (`while (!q.push(i)) {}`) and a consumer pops them, adding each into a **global** `g_sink` so the compiler cannot delete the work; built with `g++ -O3 -march=native -std=c++17 -pthread`. **In class (Lec-11 assignment)** the lock-based version had to report how many 64-byte objects per second it can push and pop.\n\nHow to benchmark properly:\n- **Defeat the optimiser**: write results to a global/`volatile` sink, or use `benchmark::DoNotOptimize`; otherwise the measured loop may vanish.\n- **Time** with `std::chrono::steady_clock` (monotonic) around the whole run for throughput (`ops/s = N / seconds`); for per-message latency, timestamp at push (`rdtsc` or `steady_clock`) and at pop and build a **histogram** (p50, p99, p99.9, max). Averages hide tail latency, which is what matters in trading.\n- **Pin threads** to specific cores (`taskset -c 2,4 ./bench`, `pthread_setaffinity_np`); compare same-physical-core hyper-threads vs different cores vs different sockets (cache-line transfer cost differs a lot).\n- **Warm up** (first iterations include page faults and cold caches), repeat runs and report the median, fix CPU frequency (disable turbo/power saving) to reduce noise.\n- **Profile**: `perf stat` (cycles, instructions, cache-misses), `perf c2c` (false sharing / HITM), `perf record` for hot spots.\n- Compare variants: mutex queue vs spinlock queue vs naive lock-free vs padded vs cached-index. Typical orders of magnitude: mutex ~1–10 M ops/s, naive SPSC ~20–50 M, padded ~100 M, cached indices 200 M+ (hardware dependent)."
  },
  {
   "heading": "Quick revision",
   "body": "- `std::atomic<T>`: indivisible, race-free ops; `fetch_add` returns the old value; `x = x + 1` is not an atomic increment.\n- x86: atomic loads and relaxed/release stores are plain `mov`; RMW = `lock` prefix; seq_cst store = `xchg`/`mfence`.\n- Compiler and CPU both reorder; the store buffer allows store→load reordering even on x86.\n- release store + acquire load of the **same** atomic that reads that value = synchronizes-with → earlier writes visible.\n- Acquire: later accesses cannot move above; release: earlier accesses cannot move below.\n- relaxed = atomicity only (counters, own index); seq_cst = default, single total order, most expensive.\n- CAS: on failure `expected` is updated; use `compare_exchange_weak` in loops (spurious failure allowed).\n- ABA: value returns to A after changes; fix with tagged pointers, hazard pointers, epochs, or no reuse.\n- Lock-free = system-wide progress; wait-free = every thread in bounded steps; SPSC push/pop are wait-free.\n- Treiber stack: retry `while (!CAS)`, compute `next` from the loaded head, handle empty, don't free without reclamation.\n- SPSC: one writer per index, no CAS; power-of-2 capacity + mask; ever-increasing unsigned indices.\n- push: write slot, then `tail.store(release)`; pop: `tail.load(acquire)`, read slot, `head.store(release)`.\n- `alignas(64)` on head and tail (and buffer) removes false sharing; cached indices cut cross-core traffic further.\n- Benchmark: global sink, -O3, pinned cores, warm-up, percentiles, `perf c2c` for HITM."
  },
  {
   "heading": "Exam traps",
   "body": "- Atomic ≠ ordered: relaxed atomics are race-free but do not order other memory; message passing needs release/acquire.\n- Release/acquire on **different** variables do not synchronize.\n- `load(memory_order_release)` or `store(memory_order_acquire)` is invalid (UB); the class draft had the orders swapped.\n- \"x86 is strongly ordered so relaxed is fine\" is wrong: the **compiler** can still reorder or hoist, and the store→load reordering still exists.\n- `compare_exchange_weak` can fail even if the values are equal: always in a loop.\n- Forgetting that CAS **modifies `expected`** on failure (or writing `while (CAS)` instead of `while (!CAS)`, as in the class draft).\n- Lock-free does not imply faster, and does not imply wait-free.\n- Freeing nodes in a lock-free structure without hazard pointers/epochs → use-after-free and ABA.\n- `std::atomic<BigStruct>` may silently use a lock: check `is_always_lock_free`.\n- SPSC queue used with two producers is broken (both read the same tail and overwrite one slot).\n- Capacity not a power of 2 with `& (size-1)` gives wrong slots; with `%` and wrapping 32-bit indices it breaks at the wrap.\n- Padding with `alignas(64)` on the first member only is not enough; each independently written member needs its own line.\n- A benchmark whose result is unused can be optimised away completely; always use the result (the class `g_sink`).\n- `volatile` is never a substitute for `std::atomic`."
  }
 ],
 "keyTerms": [
  {
   "term": "std::atomic<T>",
   "def": "Type whose operations are indivisible and race-free, with selectable memory ordering."
  },
  {
   "term": "fetch_add",
   "def": "Atomic read-modify-write that adds and returns the previous value (lock xadd on x86)."
  },
  {
   "term": "Memory order",
   "def": "Parameter (relaxed, acquire, release, acq_rel, seq_cst) controlling how an atomic op orders surrounding memory accesses."
  },
  {
   "term": "memory_order_relaxed",
   "def": "Atomicity only, no ordering of other reads/writes; for counters and a thread's own index."
  },
  {
   "term": "Acquire",
   "def": "Load ordering: no later access in the same thread may be reordered before it."
  },
  {
   "term": "Release",
   "def": "Store ordering: no earlier access in the same thread may be reordered after it."
  },
  {
   "term": "seq_cst",
   "def": "Default order: acquire/release plus a single total order of all seq_cst operations seen by all threads."
  },
  {
   "term": "Synchronizes-with",
   "def": "Relation between a release store and an acquire load of the same atomic that reads its value."
  },
  {
   "term": "Happens-before",
   "def": "Transitive ordering from sequenced-before and synchronizes-with; guarantees visibility of earlier writes."
  },
  {
   "term": "Store buffer",
   "def": "Per-core queue of pending stores; lets later loads run before earlier stores are globally visible."
  },
  {
   "term": "TSO",
   "def": "Total Store Order, the x86 memory model: only store-to-load reordering is allowed."
  },
  {
   "term": "CAS",
   "def": "Compare-and-swap (compare_exchange): if value == expected write desired, else load the current value into expected."
  },
  {
   "term": "compare_exchange_weak",
   "def": "CAS that may fail spuriously; cheaper on LL/SC architectures and meant for retry loops."
  },
  {
   "term": "ABA problem",
   "def": "A CAS succeeds because a value changed from A to B and back to A, hiding an intervening modification."
  },
  {
   "term": "Tagged pointer",
   "def": "Pointer combined with a version counter so that CAS detects ABA."
  },
  {
   "term": "Hazard pointer",
   "def": "Per-thread published pointer marking a node in use so it is not freed until no thread references it."
  },
  {
   "term": "Lock-free",
   "def": "Progress guarantee: some thread always completes its operation in a finite number of steps."
  },
  {
   "term": "Wait-free",
   "def": "Progress guarantee: every thread completes each operation in a bounded number of its own steps."
  },
  {
   "term": "Treiber stack",
   "def": "Classic lock-free stack using CAS on an atomic head pointer."
  },
  {
   "term": "SPSC queue",
   "def": "Single-producer single-consumer ring buffer where each index has one writer, so only acquire/release loads and stores are needed."
  },
  {
   "term": "Power-of-2 masking",
   "def": "Using idx & (capacity - 1) instead of idx % capacity; requires capacity to be a power of two."
  },
  {
   "term": "Cached index",
   "def": "SPSC optimisation where each side keeps a local copy of the other's index and refreshes it only when needed."
  },
  {
   "term": "perf c2c",
   "def": "Linux perf tool that reports cache-to-cache transfers (HITM), used to find false sharing."
  },
  {
   "term": "Placement new",
   "def": "new (ptr) T(args) constructs an object in already-allocated raw storage."
  }
 ],
 "mcqs": [
  {
   "q": "What does this print?\n\n    std::atomic<int> a{5};\n    int old = a.fetch_add(3);\n    std::cout << old << ' ' << a.load();",
   "options": [
    "5 8",
    "8 8",
    "5 5",
    "8 5"
   ],
   "answer": 0,
   "explanation": "fetch_add returns the value before the addition (5) and leaves 8 in the atomic.",
   "distractors": "The other options confuse the returned old value with the new value.",
   "source": "lecture",
   "id": "L10-m1"
  },
  {
   "q": "Two threads each run `for (int i = 0; i < 1'000'000; ++i) c.fetch_add(1, std::memory_order_relaxed);` on `std::atomic<int> c{0}`. After both join, what does `c.load()` return?",
   "options": [
    "Usually less than 2000000 because relaxed has no ordering",
    "Exactly 2000000",
    "Undefined behaviour",
    "Between 1000000 and 2000000"
   ],
   "answer": 1,
   "explanation": "Relaxed RMWs are still atomic: every increment is applied to the single modification order of c, and join makes the final value visible.",
   "distractors": "Relaxed drops ordering of other memory, not atomicity; there is no data race.",
   "source": "lecture",
   "id": "L10-m2"
  },
  {
   "q": "Is `x = x + 1;` on a `std::atomic<int> x` an atomic increment?",
   "options": [
    "Yes, all operations on an atomic are atomic as a whole",
    "It does not compile",
    "No: it is an atomic load followed by a separate atomic store, so another thread's update in between can be lost",
    "Yes, but only with seq_cst"
   ],
   "answer": 2,
   "explanation": "Each operation is atomic individually, but the expression is two operations. Use ++x, x += 1 or fetch_add.",
   "distractors": "It compiles (implicit load and store), and no memory order makes two operations into one.",
   "source": "lecture",
   "id": "L10-m3"
  },
  {
   "q": "On x86-64, which atomic operation typically compiles to an instruction with an implicit or explicit full barrier (xchg or mov + mfence)?",
   "options": [
    "load(memory_order_acquire)",
    "store(memory_order_release)",
    "load(memory_order_relaxed)",
    "store(memory_order_seq_cst)"
   ],
   "answer": 3,
   "explanation": "x86 TSO already gives acquire loads and release stores for free; only seq_cst stores must prevent store-to-load reordering, so GCC emits xchg (or mov + mfence).",
   "distractors": "Acquire/relaxed loads and release stores are plain mov on x86.",
   "source": "lecture",
   "id": "L10-m4"
  },
  {
   "q": "Thread 1: `data = 42; flag.store(true, std::memory_order_release);`\nThread 2: `while (!flag.load(std::memory_order_acquire)) {} std::cout << data;`\n(`data` is a plain int.) What is printed?",
   "options": [
    "0 or 42",
    "Undefined: data is not atomic",
    "Always 42",
    "Always 0"
   ],
   "answer": 2,
   "explanation": "The acquire load that reads true synchronizes-with the release store, so the write to data happens-before the read: no race and it prints 42.",
   "distractors": "Non-atomic data is fine when ordered by release/acquire; that is the whole point of message passing.",
   "source": "lecture",
   "id": "L10-m5"
  },
  {
   "q": "Same code as message passing, but both the store and the load of `flag` use `memory_order_relaxed`. What is true?",
   "options": [
    "The read of data is a data race (UB); it may print a stale value, especially on ARM",
    "It still always prints 42",
    "It does not compile",
    "It deadlocks"
   ],
   "answer": 0,
   "explanation": "Relaxed gives no happens-before between the data write and read, so the non-atomic access races. x86 hardware hides it often, but the compiler may still reorder.",
   "distractors": "Relaxed compiles and the loop still terminates eventually.",
   "source": "lecture",
   "id": "L10-m6"
  },
  {
   "q": "Store-buffer litmus test with all operations `memory_order_release` / `memory_order_acquire`:\n\n    T1: x.store(1); r1 = y.load();\n    T2: y.store(1); r2 = x.load();\n\nCan r1 == 0 && r2 == 0?",
   "options": [
    "No, release/acquire forbids it",
    "Only on ARM",
    "Only if the compiler is buggy",
    "Yes, even on x86, because a store followed by a load of a different variable can be reordered (store buffer); only seq_cst forbids it"
   ],
   "answer": 3,
   "explanation": "Acquire/release does not order a store before a later load of a different location. Each store sits in its core's store buffer while the loads read 0. seq_cst forbids the outcome.",
   "distractors": "This is the one reordering x86 TSO allows, so it is not ARM-specific.",
   "source": "lecture",
   "id": "L10-m7"
  },
  {
   "q": "What does this do when `a` holds 7?\n\n    int expected = 5;\n    bool ok = a.compare_exchange_strong(expected, 10);",
   "options": [
    "ok = true, a = 10",
    "ok = false, a = 7, expected = 7",
    "ok = false, a = 7, expected = 5",
    "ok = false, a = 5"
   ],
   "answer": 1,
   "explanation": "The values differ, so no store happens and the current value 7 is written into expected; strong CAS never fails spuriously.",
   "distractors": "Forgetting that expected is updated on failure is the classic mistake.",
   "source": "lecture",
   "id": "L10-m8"
  },
  {
   "q": "Why is `compare_exchange_weak` normally used inside a loop?",
   "options": [
    "It can fail spuriously even when the value equals expected, and the loop retries; on LL/SC CPUs it is cheaper than strong",
    "It only works in loops",
    "It is always faster on x86",
    "It never updates expected"
   ],
   "answer": 0,
   "explanation": "On ARM/POWER the load-linked/store-conditional pair may fail for unrelated reasons; a loop absorbs that. On x86 weak and strong compile to the same lock cmpxchg.",
   "distractors": "It updates expected like strong, and has no speed advantage on x86.",
   "source": "lecture",
   "id": "L10-m9"
  },
  {
   "q": "In the class draft of the lock-free stack, push was written as:\n\n    Node* newNode = new Node(val, head);\n    while (head.compare_exchange_weak(newNode->next, newNode)) {}\n\nWhat is wrong?",
   "options": [
    "Nothing; it is a correct Treiber push",
    "The loop condition is inverted: it should retry while the CAS FAILS (while (!...)); as written it exits on failure and corrupts the node on success",
    "newNode->next must be atomic",
    "compare_exchange_weak cannot take a member as expected"
   ],
   "answer": 1,
   "explanation": "If the first CAS fails (another thread pushed), the loop exits without pushing; if it succeeds, the loop runs again, the CAS fails because head is now newNode, and the failure writes newNode into newNode->next, a self-loop. The fix is while (!head.compare_exchange_weak(newNode->next, newNode)).",
   "distractors": "next does not need to be atomic (it is published by the CAS), and expected can be any lvalue T.",
   "source": "lecture",
   "id": "L10-m10"
  },
  {
   "q": "What is the ABA problem?",
   "options": [
    "Two threads lock mutexes A and B in opposite order",
    "An atomic is read twice and gets two values",
    "A CAS succeeds because the value is again equal to what was read, although the structure was modified (and maybe freed and reused) in between",
    "A thread acquires a lock it already holds"
   ],
   "answer": 2,
   "explanation": "CAS compares values, not history. In a lock-free stack a node can be popped, freed and reallocated at the same address, and a stale CAS then installs a dangling next pointer.",
   "distractors": "Opposite lock order is deadlock; re-locking is a recursive-lock issue.",
   "source": "lecture",
   "id": "L10-m11"
  },
  {
   "q": "Which is NOT a fix for ABA in a lock-free stack?",
   "options": [
    "Tagged pointers with a version counter CASed together with the pointer",
    "Hazard pointers or epoch-based reclamation",
    "Never reusing node memory while other threads may hold references",
    "Using memory_order_seq_cst on the CAS"
   ],
   "answer": 3,
   "explanation": "Memory order controls visibility ordering, not whether a value was changed and changed back. The other three prevent a recycled node from looking unchanged.",
   "distractors": "Tagged pointers, safe reclamation and no-reuse are the standard fixes.",
   "source": "lecture",
   "id": "L10-m12"
  },
  {
   "q": "Which progress guarantee do the push and pop of the class SPSC ring buffer provide?",
   "options": [
    "Blocking",
    "Obstruction-free only",
    "Wait-free: each call finishes in a bounded number of steps (returns false if full/empty)",
    "None, they can spin forever"
   ],
   "answer": 2,
   "explanation": "There are no retry loops inside push/pop: a few loads, one store, return. The caller's while(!q.push(x)) spin is outside the operation.",
   "distractors": "No lock is involved, so it is not blocking.",
   "source": "lecture",
   "id": "L10-m13"
  },
  {
   "q": "Which statement about lock-free algorithms is correct?",
   "options": [
    "Lock-free means some thread always makes progress, even if others are preempted; individual threads may starve",
    "Lock-free means every thread always makes progress",
    "Lock-free means it is always faster than a mutex",
    "A spinlock-based queue is lock-free"
   ],
   "answer": 0,
   "explanation": "Lock-freedom is a system-wide progress guarantee; wait-freedom is the per-thread one. Under heavy contention CAS loops can be slower than locks.",
   "distractors": "A spinlock blocks everyone if the holder is preempted, so it is not lock-free.",
   "source": "lecture",
   "id": "L10-m14"
  },
  {
   "q": "In the SPSC queue, why does the producer read its own `tail_` with `memory_order_relaxed`?",
   "options": [
    "Because relaxed is required for push",
    "Because tail_ is not atomic",
    "Because acquire would deadlock",
    "Only the producer writes tail_, so it always sees its own latest value; no synchronization with another thread is needed for that read"
   ],
   "answer": 3,
   "explanation": "Ordering is needed only for data published by the other thread. The producer's own index has no other writer.",
   "distractors": "tail_ is atomic because the consumer reads it; acquire would be correct but unnecessary.",
   "source": "lecture",
   "id": "L10-m15"
  },
  {
   "q": "In the SPSC push, which ordering is required for the store `tail_.store(t + 1, ...)`?",
   "options": [
    "memory_order_relaxed",
    "memory_order_release",
    "memory_order_acquire",
    "memory_order_consume"
   ],
   "answer": 1,
   "explanation": "Release ensures the slot write before it is visible to the consumer whose acquire load reads the new tail. The class draft wrongly used acquire for this increment.",
   "distractors": "Acquire and consume are load orders; relaxed would let the consumer see the index before the data.",
   "source": "lecture",
   "id": "L10-m16"
  },
  {
   "q": "Why must the SPSC capacity be a power of two in the Lec-12 implementation?",
   "options": [
    "So that idx & (Capacity - 1) equals idx % Capacity and stays continuous when the 64-bit index wraps",
    "Because std::array requires it",
    "To make the queue lock-free",
    "Because cache lines are 64 bytes"
   ],
   "answer": 0,
   "explanation": "The mask replaces a slow division with an AND, which is only equal to modulo for powers of two; and 2^64 being a multiple of the capacity keeps slot numbering continuous across the wrap.",
   "distractors": "std::array accepts any size, and lock-freedom comes from the single-writer indices.",
   "source": "lecture",
   "id": "L10-m17"
  },
  {
   "q": "For `Capacity = 4096`, which slot does index 8195 map to with `idx & (Capacity - 1)`?",
   "options": [
    "4095",
    "3",
    "8195",
    "0"
   ],
   "answer": 1,
   "explanation": "8195 = 2 × 4096 + 3, and the mask keeps the low 12 bits: 3.",
   "distractors": "4095 is the mask itself, and 0 would be the result for a multiple of 4096.",
   "source": "lecture",
   "id": "L10-m18"
  },
  {
   "q": "Why are the SPSC queue's `head_` and `tail_` declared `alignas(64)`?",
   "options": [
    "To make them atomic",
    "Because std::atomic requires 64-byte alignment",
    "So each sits on its own cache line: the producer writes tail_ and the consumer writes head_, and sharing a line would cause false sharing (MESI ping-pong)",
    "To make the queue wait-free"
   ],
   "answer": 2,
   "explanation": "Back to back they would be 8 bytes apart; every push and pop would invalidate the other core's copy. perf c2c shows this as HITM.",
   "distractors": "atomic<size_t> needs only 8-byte alignment; padding affects performance, not correctness or progress.",
   "source": "lecture",
   "id": "L10-m19"
  },
  {
   "q": "In the class benchmark, why does the consumer add each popped value into a global `g_sink`?",
   "options": [
    "To check correctness",
    "Because pop requires a global output",
    "To create false sharing on purpose",
    "So the compiler cannot treat the popped values as unused and optimise away the work being measured"
   ],
   "answer": 3,
   "explanation": "If results are never used, -O3 may delete the loop body; writing them to a global is an observable effect.",
   "distractors": "It is not a correctness check, and g_sink is only touched by the consumer thread.",
   "source": "lecture",
   "id": "L10-m20"
  },
  {
   "q": "What is the main benefit of the 'cached index' optimisation in an SPSC queue?",
   "options": [
    "It makes the queue multi-producer safe",
    "It removes the need for release/acquire",
    "The producer re-reads the consumer's head_ (a cross-core cache miss) only when its local copy says the queue looks full, so shared lines are touched far less often",
    "It halves memory use"
   ],
   "answer": 2,
   "explanation": "Most pushes then touch only lines owned by the producer, cutting coherence traffic dramatically.",
   "distractors": "It does not change the single-producer rule or the memory orders needed.",
   "source": "lecture",
   "id": "L10-m21"
  },
  {
   "q": "What happens if two producer threads use an SPSC queue's push concurrently?",
   "options": [
    "Both can read the same tail_, write the same slot and store the same new tail, losing an item (a data race on the slot)",
    "It works, just slower",
    "It deadlocks",
    "The second push always returns false"
   ],
   "answer": 0,
   "explanation": "SPSC correctness relies on one writer per index; multi-producer needs a CAS or fetch_add to claim slots plus per-slot ready flags.",
   "distractors": "Nothing blocks, so no deadlock; push does not detect the other producer.",
   "source": "lecture",
   "id": "L10-m22"
  },
  {
   "q": "In the class draft (Lec-10 code.cpp):\n\n    X* arr = (X*)(::operator new(10 * sizeof(X)));\n    arr[0] = X{1};\n\nWhat is the core issue for a general (non-trivial) T?",
   "options": [
    "::operator new also runs the constructors",
    "sizeof(X) is wrong",
    "It leaks because operator new cannot be freed",
    "Raw memory has no constructed objects; assigning invokes operator= on a non-existent object. Construct with placement new (new (&arr[0]) X{1}) and later call ~X()"
   ],
   "answer": 3,
   "explanation": "::operator new only allocates bytes. For trivial types this works in practice (C++20 implicit object creation), but for types like std::string it is UB. Free with ::operator delete.",
   "distractors": "::operator new never runs constructors, and the memory can be freed with ::operator delete.",
   "source": "lecture",
   "id": "L10-m23"
  }
 ],
 "msqs": [
  {
   "q": "Which of the following are valid memory orders for an atomic LOAD? (select all that apply)",
   "options": [
    "memory_order_relaxed",
    "memory_order_acquire",
    "memory_order_release",
    "memory_order_seq_cst",
    "memory_order_acq_rel"
   ],
   "answers": [
    0,
    1,
    3
   ],
   "explanation": "Loads may be relaxed, consume, acquire or seq_cst. Release and acq_rel describe a store side and are not valid for a pure load (UB per the standard, GCC warns).",
   "id": "L10-x1"
  },
  {
   "q": "Which statements about memory_order_relaxed are true? (select all that apply)",
   "options": [
    "Relaxed operations are still atomic",
    "It is suitable for a statistics counter read after the threads join",
    "It guarantees that writes to other variables before it are visible to a thread that reads it",
    "All threads agree on a single modification order for each relaxed variable"
   ],
   "answers": [
    0,
    1,
    3
   ],
   "explanation": "Relaxed keeps atomicity and the per-variable modification order, which is enough for counters (join adds the needed synchronization). It provides no ordering for other memory, so it cannot publish data.",
   "id": "L10-x2"
  },
  {
   "q": "Which of the following create a synchronizes-with relationship? (select all that apply)",
   "options": [
    "A release store to flag, and an acquire load of flag in another thread that reads the stored value",
    "A release store to x, and an acquire load of y in another thread",
    "Unlocking a mutex, then another thread locking the same mutex",
    "Two relaxed stores to the same atomic",
    "A thread's completion and the return of join() on it"
   ],
   "answers": [
    0,
    2,
    4
   ],
   "explanation": "Release/acquire on the same variable reading the value, unlock/lock of one mutex and thread completion/join all synchronize. Different variables do not pair, and relaxed operations never synchronize.",
   "id": "L10-x3"
  },
  {
   "q": "Which statements about x86-64 are true? (select all that apply)",
   "options": [
    "An acquire load compiles to a plain mov",
    "A seq_cst store usually compiles to xchg or mov + mfence",
    "x86 never reorders any memory operations",
    "fetch_add compiles to a lock-prefixed instruction",
    "Using relaxed instead of acquire can still change the result because the compiler may reorder"
   ],
   "answers": [
    0,
    1,
    3,
    4
   ],
   "explanation": "x86 TSO gives acquire/release for free, needs a full barrier only for seq_cst stores, and uses lock-prefixed instructions for RMW. It does reorder a store with a later load (store buffer), and the compiler's freedom differs between orders.",
   "id": "L10-x4"
  },
  {
   "q": "Which statements about compare_exchange are true? (select all that apply)",
   "options": [
    "On failure, expected is overwritten with the current value",
    "compare_exchange_weak may return false even if the value equals expected",
    "compare_exchange_strong never fails",
    "It compares the object representations, so padding bytes in a struct can cause unexpected failures"
   ],
   "answers": [
    0,
    1,
    3
   ],
   "explanation": "CAS reloads expected on failure, the weak form allows spurious failure, and it compares bytes. Strong does fail whenever the value differs; it just never fails spuriously.",
   "id": "L10-x5"
  },
  {
   "q": "Which are bugs in the class draft of the lock-free stack's pop: `auto current = head; while (head.compare_exchange_weak(current, head->next)) {} current.~T();`? (select all that apply)",
   "options": [
    "The loop condition is inverted (should retry while the CAS fails)",
    "The new head should be computed from current->next, not by re-reading head",
    "It does not handle an empty stack (nullptr)",
    "Using compare_exchange_weak instead of strong is a bug",
    "Calling ~T() on a pointer does not free the node, and freeing it safely needs reclamation"
   ],
   "answers": [
    0,
    1,
    2,
    4
   ],
   "explanation": "The loop must be while(!CAS), next must come from the snapshot, the empty case must return false, and node cleanup is wrong and unsafe without hazard pointers/epochs. Using weak in a loop is correct.",
   "id": "L10-x6"
  },
  {
   "q": "Which techniques address the ABA problem? (select all that apply)",
   "options": [
    "Pairing the pointer with a version counter (tagged pointer / cmpxchg16b)",
    "Hazard pointers",
    "Epoch-based reclamation",
    "Switching the CAS to memory_order_seq_cst",
    "Adding std::this_thread::yield() in the retry loop"
   ],
   "answers": [
    0,
    1,
    2
   ],
   "explanation": "Version tags make a changed-and-restored value distinguishable, and hazard pointers/epochs stop a node from being freed and reused while referenced. Memory order and yielding do not detect intervening changes.",
   "id": "L10-x7"
  },
  {
   "q": "Which statements about progress guarantees are true? (select all that apply)",
   "options": [
    "Every wait-free algorithm is also lock-free",
    "A queue protected by a spinlock is lock-free",
    "In a lock-free algorithm an individual thread may starve",
    "Lock-free algorithms are always faster than mutex-based ones"
   ],
   "answers": [
    0,
    2
   ],
   "explanation": "Wait-free is strictly stronger than lock-free, and lock-free only guarantees system-wide progress. A spinlock blocks everyone when the holder stalls, and lock-free CAS loops can be slower under contention.",
   "id": "L10-x8"
  },
  {
   "q": "In the Lec-12 SPSC queue, which operations need acquire or release ordering? (select all that apply)",
   "options": [
    "Producer reading head_ to check for full",
    "Producer reading its own tail_",
    "Producer storing the new tail_",
    "Consumer reading tail_ to check for empty",
    "Consumer storing the new head_"
   ],
   "answers": [
    0,
    2,
    3,
    4
   ],
   "explanation": "Reads of the other thread's index are acquire, and stores of one's own index are release (publishing the slot, or freeing it). A thread's read of its own index can be relaxed because it is the only writer.",
   "id": "L10-x9"
  },
  {
   "q": "Which are design ideas the class used for the SPSC ring buffer? (select all that apply)",
   "options": [
    "Capacity is a power of 2 so indexing uses a mask instead of %",
    "Indices increase forever and size = tail - head",
    "A std::mutex around each push and pop",
    "Full/empty checks marked [[unlikely]]",
    "head and tail on separate cache lines"
   ],
   "answers": [
    0,
    1,
    3,
    4
   ],
   "explanation": "Masking, ever-increasing indices, [[unlikely]] on the rare branches and alignas(64) padding were all class ideas. The whole point of the SPSC design is that no mutex is needed.",
   "id": "L10-x10"
  },
  {
   "q": "Which would make a benchmark of the SPSC queue more trustworthy? (select all that apply)",
   "options": [
    "Using the popped values (e.g. summing into a global sink)",
    "Pinning producer and consumer to specific cores",
    "Reporting only the very first run",
    "Reporting latency percentiles (p50/p99/p99.9), not just the mean",
    "Including a warm-up phase"
   ],
   "answers": [
    0,
    1,
    3,
    4
   ],
   "explanation": "Using results defeats dead-code elimination, pinning and warm-up reduce noise, and percentiles expose tail latency. A single cold first run includes page faults and cache misses and is noisy.",
   "id": "L10-x11"
  },
  {
   "q": "Which of these are data races or UB? (select all that apply)",
   "options": [
    "Two threads calling fetch_add on the same std::atomic",
    "A plain int written by thread A and read by thread B, ordered by a release/acquire pair on a flag",
    "A plain int written by thread A and read by thread B, with only relaxed operations on the flag",
    "Calling load(std::memory_order_release) on an atomic",
    "Two producers pushing concurrently into an SPSC queue with plain slot writes"
   ],
   "answers": [
    2,
    3,
    4
   ],
   "explanation": "Relaxed flags do not order the plain int, a release load is an invalid order, and two producers write the same slot concurrently. Atomic RMWs never race, and release/acquire properly orders the plain access.",
   "id": "L10-x12"
  },
  {
   "q": "Which statements about std::atomic<T> are true? (select all that apply)",
   "options": [
    "std::atomic is copyable",
    "is_lock_free() may be false for large trivially copyable types",
    "The default memory order is memory_order_seq_cst",
    "std::atomic<int>::fetch_add returns the previous value",
    "Any type can be used, even non-trivially copyable ones like std::string"
   ],
   "answers": [
    1,
    2,
    3
   ],
   "explanation": "Large types may be implemented with a hidden lock, the default order is seq_cst and fetch_add returns the old value. Atomics are not copyable, and T must be trivially copyable, so std::string is not allowed.",
   "id": "L10-x13"
  }
 ],
 "short": [
  {
   "q": "Explain acquire and release semantics with the message-passing example (payload + ready flag). What goes wrong with relaxed, and what does each order cost on x86 vs ARM?",
   "checks": [
    {
     "label": "Release on store: earlier writes not moved after",
     "patterns": [
      "release"
     ]
    },
    {
     "label": "Acquire on load: later reads not moved before",
     "patterns": [
      "acquire"
     ]
    },
    {
     "label": "Synchronizes-with / happens-before on same variable",
     "patterns": [
      "synchroni[sz]es[- ]with",
      "happens[- ]before"
     ]
    },
    {
     "label": "Relaxed gives no ordering / race",
     "patterns": [
      "relaxed"
     ]
    },
    {
     "label": "x86 free (mov) vs ARM barriers / ldar stlr",
     "patterns": [
      "\\bmov\\b",
      "TSO",
      "ldar",
      "stlr",
      "dmb"
     ]
    }
   ],
   "modelAnswer": "int payload;  std::atomic<bool> ready{false};\n\nProducer: payload = 42; ready.store(true, std::memory_order_release);\nConsumer: while (!ready.load(std::memory_order_acquire)) {} use(payload);\n\nA release store forbids any earlier read or write in that thread from being reordered after it, so payload is written before ready becomes visible. An acquire load forbids later reads/writes from moving before it, so the consumer reads payload only after it saw ready == true. When the acquire load reads the value written by the release store on the same variable, the store synchronizes-with the load, so payload = 42 happens-before use(payload): no data race, guaranteed 42.\n\nWith relaxed on both, the flag is still atomic but nothing orders payload: the compiler or CPU (store buffer, out-of-order execution) may make ready visible first, so the consumer can read a stale payload, and the non-atomic access is a data race (UB).\n\nCost: x86 is TSO, so acquire loads and release stores are plain mov instructions (only the compiler is restricted); only seq_cst stores need xchg/mfence. On ARM, acquire/release use ldar/stlr (or dmb barriers), which are more expensive than plain ldr/str, so relaxed vs acquire/release is a real hardware difference there.",
   "explanation": "Define both halves, the pairing rule, the failure mode with relaxed, and the per-architecture cost.",
   "id": "L10-s1"
  },
  {
   "q": "Write a correct lock-free (Treiber) stack push and pop with compare_exchange_weak, and point out the bugs in the class draft.",
   "checks": [
    {
     "label": "compare_exchange_weak in a while(!...) loop",
     "patterns": [
      "while\\s*\\(\\s*!",
      "retry"
     ]
    },
    {
     "label": "Next computed from the loaded head / old->next",
     "patterns": [
      "->next"
     ]
    },
    {
     "label": "Handles empty stack nullptr",
     "patterns": [
      "nullptr",
      "empty"
     ]
    },
    {
     "label": "Mentions ABA or reclamation",
     "patterns": [
      "ABA",
      "hazard",
      "reclamation",
      "epoch"
     ]
    },
    {
     "label": "Uses release/acquire orders",
     "patterns": [
      "release",
      "acquire"
     ]
    }
   ],
   "modelAnswer": "template <typename T>\nclass LockFreeStack {\n    struct Node { T val; Node* next; };\n    std::atomic<Node*> head_{nullptr};\npublic:\n    void push(T v) {\n        Node* n = new Node{std::move(v), head_.load(std::memory_order_relaxed)};\n        while (!head_.compare_exchange_weak(n->next, n,\n                   std::memory_order_release, std::memory_order_relaxed)) {}\n        // retry: on failure n->next is refreshed with the current head\n    }\n    bool pop(T& out) {\n        Node* old = head_.load(std::memory_order_acquire);\n        while (old && !head_.compare_exchange_weak(old, old->next,\n                   std::memory_order_acquire, std::memory_order_acquire)) {}\n        if (!old) return false;           // empty stack (nullptr)\n        out = std::move(old->val);\n        return true;                      // node not freed: see below\n    }\n};\n\nBugs in the class draft: (1) while (head.compare_exchange_weak(...)) loops while the CAS succeeds; it must be while (!CAS) so it retries on failure. (2) pop passed head->next as the desired value, re-reading the shared head instead of using current->next from the snapshot. (3) No check for the empty stack (nullptr) and no return statements. (4) current.~T() destroys nothing useful; the node must be deleted, but deleting it immediately is unsafe: another thread may still be reading old->next (use-after-free), and a freed address reused by new causes the ABA problem. Safe reclamation needs hazard pointers, epoch-based reclamation, tagged pointers or a non-recycling pool.",
   "explanation": "Correct CAS loops, next from the snapshot, empty handling, and awareness of ABA/reclamation.",
   "id": "L10-s2"
  },
  {
   "q": "Explain the ABA problem using a lock-free stack, and give two fixes.",
   "checks": [
    {
     "label": "Thread reads A then is preempted",
     "patterns": [
      "preempt",
      "paus",
      "delay",
      "sleep"
     ]
    },
    {
     "label": "Changed to B and back to A / same address reused",
     "patterns": [
      "back to A",
      "same address",
      "reus"
     ]
    },
    {
     "label": "CAS succeeds wrongly",
     "patterns": [
      "CAS",
      "compare_exchange"
     ]
    },
    {
     "label": "Fix: tagged pointer/version counter",
     "patterns": [
      "tag",
      "version",
      "counter"
     ]
    },
    {
     "label": "Fix: hazard pointers / epoch",
     "patterns": [
      "hazard",
      "epoch",
      "RCU"
     ]
    }
   ],
   "modelAnswer": "Stack: head -> A -> B -> C. Thread 1 starts pop: it loads old = A and next = A->next = B, then is preempted before its CAS. Thread 2 pops A, pops B and frees both, then pushes a new node; the allocator reuses A's address, so the stack is head -> A' -> C where A' has the same address as A. Thread 1 resumes and runs CAS(head, expected = A, desired = B). The CAS compares only the pointer value; head is \"A\" again (changed A -> ... -> back to A), so the CAS succeeds and sets head = B, a freed node. The stack is corrupted and later accesses are use-after-free.\n\nFixes:\n1. Tagged pointers: store a version counter next to the pointer and CAS both together (cmpxchg16b, or tag bits in the unused top of a 64-bit pointer); every change increments the tag, so the stale CAS fails.\n2. Safe memory reclamation: hazard pointers (each thread publishes the node it is about to dereference, and nodes are freed only when no hazard pointer refers to them) or epoch-based reclamation / RCU; then an address cannot be reused while someone still holds it.\n3. In HFT, often simply never free/reuse nodes during the session, or use an SPSC queue, which has no CAS at all.",
   "explanation": "Concrete interleaving with address reuse, why CAS is fooled, and at least two standard fixes.",
   "id": "L10-s3"
  },
  {
   "q": "Walk through the SPSC queue's push and pop (Lec-12): which memory order each atomic access uses and why, why no CAS is needed, and why it is wait-free.",
   "checks": [
    {
     "label": "Single writer per index, no CAS needed",
     "patterns": [
      "one writer",
      "single writer",
      "only the producer",
      "no CAS"
     ]
    },
    {
     "label": "Release store of tail / head",
     "patterns": [
      "release"
     ]
    },
    {
     "label": "Acquire load of other index",
     "patterns": [
      "acquire"
     ]
    },
    {
     "label": "Relaxed load of own index",
     "patterns": [
      "relaxed"
     ]
    },
    {
     "label": "Wait-free bounded steps / returns false",
     "patterns": [
      "wait[- ]free",
      "bounded"
     ]
    }
   ],
   "modelAnswer": "push (producer only):\n1. t = tail_.load(relaxed): the producer is the only writer of tail_, so it always sees its own last value.\n2. if (t - head_.load(acquire) == Capacity) return false: acquire pairs with the consumer's release store of head_, so a slot the consumer freed is really done being read before we overwrite it.\n3. slots_[t & kMask] = v: a plain write; this slot belongs to the producer until it is published.\n4. tail_.store(t + 1, release): publishes the slot; the write in step 3 cannot move after this store.\n\npop (consumer only):\n1. h = head_.load(relaxed): the consumer is the only writer of head_.\n2. if (h == tail_.load(acquire)) return false: acquire pairs with the producer's release of tail_, so the slot contents written before it are visible.\n3. out = slots_[h & kMask].\n4. head_.store(h + 1, release): gives the slot back; the read in step 3 cannot move after it.\n\nNo CAS or lock is needed because each index has a single writer: only the producer writes tail_ and only the consumer writes head_, so there is never a conflicting read-modify-write. Each operation is a fixed, bounded number of steps and returns false instead of waiting when full or empty, so push and pop are wait-free (the caller's retry loop is outside the operation).",
   "explanation": "Exact orders with justification, the single-writer argument and the progress guarantee.",
   "id": "L10-s4"
  },
  {
   "q": "Why does the SPSC queue place head_ and tail_ (and the buffer) on separate cache lines? Describe the measurement that shows the problem and a further optimisation.",
   "checks": [
    {
     "label": "False sharing",
     "patterns": [
      "false sharing"
     ]
    },
    {
     "label": "Same 64-byte line, 8 bytes apart",
     "patterns": [
      "64",
      "8 bytes",
      "same (cache )?line"
     ]
    },
    {
     "label": "MESI invalidation ping-pong",
     "patterns": [
      "MESI",
      "invalidat",
      "ping"
     ]
    },
    {
     "label": "perf c2c / HITM",
     "patterns": [
      "perf c2c",
      "HITM"
     ]
    },
    {
     "label": "Cached index optimisation",
     "patterns": [
      "cache[d]? (index|copy)",
      "headCache",
      "local copy"
     ]
    }
   ],
   "modelAnswer": "The producer writes tail_ on every push and the consumer writes head_ on every pop. Declared back to back they are 8 bytes apart, on the same 64-byte cache line, so this is false sharing: under MESI each write needs the line in Modified state, which invalidates the other core's copy, and the line ping-pongs between the two cores (~50-100 ns per transfer) even though they write different variables. alignas(64) on tail_, head_ and the slot array gives each its own line, so a write by one side no longer evicts the other's index (typically a 2-5x throughput gain).\n\nMeasurement: run the benchmark (10 million pushes/pops, threads pinned to different cores) and compare throughput of the naive and padded layouts; perf c2c shows the naive layout with heavy HITM traffic (loads hitting a line Modified in another core's cache) on the index line. The class helper index_gap_bytes() prints 8 vs 64.\n\nFurther optimisation: cached indices. The producer keeps a local copy (headCache) of the consumer's head and only reloads the real head_ when the cached value says the queue looks full; the consumer keeps tailCache the same way. Most operations then touch only lines the thread owns, cutting cross-core traffic again.",
   "explanation": "False sharing explanation, how it is detected, and the next optimisation.",
   "id": "L10-s5"
  },
  {
   "q": "List and explain the SPSC design points from class: power-of-2 capacity, ever-increasing indices, [[unlikely]], pop by reference, and raw storage. What were the bugs in the Lec-10 draft?",
   "checks": [
    {
     "label": "Mask instead of modulo",
     "patterns": [
      "mask",
      "& ?\\(?\\w* ?- ?1",
      "modulo"
     ]
    },
    {
     "label": "Ever-increasing unsigned indices, wrap-around safe",
     "patterns": [
      "wrap",
      "ever[- ]increasing",
      "never reset",
      "unsigned"
     ]
    },
    {
     "label": "[[unlikely]] / branch layout",
     "patterns": [
      "unlikely"
     ]
    },
    {
     "label": "Placement new / operator new raw storage",
     "patterns": [
      "placement new",
      "operator new"
     ]
    },
    {
     "label": "Swapped memory orders in draft",
     "patterns": [
      "swapped",
      "wrong order",
      "acquire on the store",
      "release on the load",
      "reversed"
     ]
    }
   ],
   "modelAnswer": "1. Power-of-2 capacity: idx & (Capacity - 1) replaces idx % Capacity. A modulo is a div instruction (20-40 cycles); the mask is one cycle, and it is only equal to modulo for powers of two.\n2. Ever-increasing indices: head and tail are never reset; size = tail - head, empty when equal, full when tail - head == Capacity. With unsigned 64-bit size_t the subtraction is correct even after wrap-around (modulo 2^64), and since 2^64 is a multiple of a power-of-2 capacity, the masked slot sequence stays continuous across the wrap. It also avoids wasting one slot to tell full from empty.\n3. [[unlikely]] on the full/empty checks: those branches are rare, so the compiler lays out the common path as straight-line fall-through code, keeping the pipeline fed.\n4. pop(T& out) writes into the caller's object instead of returning by value, avoiding an extra copy/temporary.\n5. Raw storage: ::operator new(sizeof(T) * size) allocates bytes without constructing objects; push must use placement new (new (&slot) T(v)) and pop must call ~T() after moving out; free with ::operator delete. Assigning into unconstructed memory (as in the class code.cpp example) is UB for non-trivial types.\n\nBugs in the Lec-10 draft: the memory orders were swapped/reversed (acquire on the index increment that publishes, release on the load that reads; it must be release on the store and acquire on the load), it used % instead of the mask, it called delete on memory from ::operator new (must be ::operator delete, after destroying live elements), and the index increment was a read-modify-write where a simple store by the single owner is enough.",
   "explanation": "Each design point with its reason, plus spotting the memory-order mistake in the draft.",
   "id": "L10-s6"
  }
 ],
 "quiz": [],
 "coding": [
  {
   "id": "spsc-ring-buffer",
   "title": "SPSC Lock-Free Ring Buffer"
  },
  {
   "id": "lock-free-stack",
   "title": "Lock-Free Treiber Stack with an ABA Guard"
  }
 ],
 "prev": {
  "num": 9,
  "file": "lecture-09.html"
 },
 "next": {
  "num": 11,
  "file": "lecture-11.html"
 }
};
