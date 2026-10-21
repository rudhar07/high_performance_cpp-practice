window.PAGE = {
 "num": 13,
 "title": "Low Latency C++ Hacks",
 "summary": "The hardware-level tricks behind low-latency C++: how the pipeline and branch predictor work and how to write predictable or branch-free code, bitwise tricks (the power-of-two masks from the class SPSC queue), cache-friendly layouts, alignment and padding, and the trade-offs of unsigned vs signed, float vs double and const.",
 "notes": [
  {
   "heading": "The pipeline and why branches matter",
   "body": "A modern x86 core is **pipelined, superscalar and out-of-order**: it fetches and decodes ~4-6 instructions per cycle, renames registers, executes whatever is ready on many ports and retires in order. To keep the front end fed it must know the next instruction address *before* the current branch is resolved, so it **predicts**.\n\n| Event | Typical cost (3-4 GHz) |\n|---|---|\n| Correctly predicted branch | ~0-1 cycle |\n| Mispredicted branch | ~15-20 cycles (pipeline flush), ~5 ns |\n| L1 hit | ~4 cycles (~1 ns) |\n| L2 hit | ~12-14 cycles (~4 ns) |\n| L3 hit | ~40-70 cycles (~10-20 ns) |\n| DRAM | ~200-300 cycles (~60-100 ns) |\n\nThe predictor (pattern history + **BTB**, branch target buffer, for targets; a separate predictor for indirect branches such as virtual calls) learns patterns: always taken, alternating, short loops. It fails on **data-dependent random** branches (e.g. `if (price > threshold)` on noisy data).\n\n**Dependency chains** also stall the pipeline: `s += a[i]` makes each add wait for the previous one (latency-bound). Splitting into several independent accumulators exposes **instruction-level parallelism**:\n\n```cpp\ndouble s0 = 0, s1 = 0, s2 = 0, s3 = 0;\nfor (size_t i = 0; i + 4 <= n; i += 4) { s0 += a[i]; s1 += a[i+1]; s2 += a[i+2]; s3 += a[i+3]; }\ndouble s = (s0 + s1) + (s2 + s3);   // ~3-4x faster on a 4-cycle-latency FP add\n```"
  },
  {
   "heading": "Making branches predictable: likely, unlikely, hot and cold paths",
   "body": "```cpp\nif (__builtin_expect(msg.seq != expected_seq, 0)) [[unlikely]] {   // gap: rare\n    request_retransmit();                                         // cold path\n    return;\n}\napply(msg);                                                       // hot path falls through\n```\n\n- `[[likely]]` / `[[unlikely]]` (C++20) and `__builtin_expect(cond, value)` mainly change **code layout**: the expected path becomes the straight-line fall-through, the cold code moves to the end of the function or a separate section. Fewer taken branches = better I-cache use.\n- `[[gnu::cold]]` / `__attribute__((cold, noinline))` on error handlers keeps them out of the hot code.\n- **Fail fast, rarely**: check all error conditions with one combined test on the hot path (`if (unlikely(flags & ERROR_MASK))`), handle the details in a cold function.\n- `__builtin_unreachable()` / C++23 `[[assume(x > 0)]]` tell the compiler a case cannot happen (UB if it does).\n- **Sort or partition data** so a branch becomes predictable, or move the condition out of the loop (loop unswitching: decide once, run a specialised loop).\n- **Lookup tables / jump tables** replace long `if`-`else` chains on a message type with one indexed load or an indirect jump."
  },
  {
   "heading": "Conditional operators and branchless code",
   "body": "The ternary operator `c ? a : b` and boolean arithmetic let you express selection without control flow; the compiler typically emits `cmov` (x86) or `csel` (ARM).\n\n```cpp\nint  mn   = (a < b) ? a : b;                // cmp + cmov\nlong cnt  = 0;\nfor (int x : v) cnt += (x > limit);          // bool converts to 0/1: no branch\nint  sel  = b ^ ((a ^ b) & -(int)(a < b));   // mask select: a if a<b else b\nint  abs32(int x) { int m = x >> 31; return (x ^ m) - m; }   // arithmetic shift (defined since C++20); UB for INT_MIN like std::abs\n```\n\n- `&&` and `||` **short-circuit**, so they compile to branches. On cheap, side-effect-free `bool` operands, `&` and `|` evaluate both sides and can be branch-free: `if ((a > 0) & (b > 0))`.\n- Branchless is a win when the branch is **unpredictable** and both sides are cheap. It is a loss when the branch is well predicted (branchless always pays both sides and adds a data dependency).\n- The compiler may turn your branchless source back into a branch, or your branch into `cmov`; check the assembly (Compiler Explorer, `objdump -d`).\n- Classic result: summing elements `>= 128` of random bytes is ~5x faster after sorting, or with `sum += (x >= 128) ? x : 0` compiled to cmov / vectorised, regardless of order."
  },
  {
   "heading": "Bitwise operators and bit tricks",
   "body": "| Trick | Expression | Notes |\n|---|---|---|\n| Modulo by power of two | `i & (N - 1)` | Equals `i % N` for unsigned i. **In class:** the SPSC ring buffer uses `kMask = Capacity - 1` and `slots_[t & kMask]`, with `static_assert((Capacity & (Capacity - 1)) == 0)` |\n| Is power of two | `x && !(x & (x - 1))` | `x & (x-1)` clears the lowest set bit |\n| Lowest set bit | `x & -x` (unsigned) | Isolates it |\n| Index of lowest / highest set bit | `__builtin_ctzll(x)`, `63 - __builtin_clzll(x)`, C++20 `std::countr_zero`, `std::bit_width` | Undefined for x == 0 with the builtins |\n| Count bits | `__builtin_popcountll(x)`, `std::popcount` | One `popcnt` instruction |\n| Multiply / divide by 2^k | `x << k`, `x >> k` (unsigned) | Compilers already do this for constants |\n| Flags | `enum : uint8_t { Buy = 1, IOC = 2, PostOnly = 4 }; if (f & IOC)` | Packs many booleans into one byte |\n| Round up to multiple of 64 | `(n + 63) & ~size_t(63)` | Alignment math |\n\n```cpp\n// bitmap of non-empty price levels: next best ask above index i (i < 63 here)\nstd::uint64_t w = mask >> (i + 1);\nint next = w ? i + 1 + __builtin_ctzll(w) : -1;   // one instruction instead of a loop\n```\n\nRules to remember:\n\n- Shifting by a count >= the bit width (e.g. `1u << 32` on a 32-bit unsigned) is **UB**.\n- Left-shifting a negative value was UB before C++20; since C++20 integers are two's complement and it is defined. Right-shifting a negative value is arithmetic (sign-extending) since C++20, implementation-defined before.\n- Use `1ULL << k` for k >= 31, since `1 << 31` overflows a 32-bit `int`.\n- The XOR swap (`a ^= b; b ^= a; a ^= b;`) is **not** faster than `std::swap` (it creates a dependency chain) and breaks if `a` and `b` alias."
  },
  {
   "heading": "Cache optimisations",
   "body": "Cache line = **64 bytes**: the unit of transfer between memory and caches. Every miss brings in 64 B; use all of it.\n\n1. **Spatial locality**: traverse memory in order. C++ 2-D arrays are **row-major**, so loop over the last index innermost:\n\n```cpp\nfor (int i = 0; i < N; ++i) for (int j = 0; j < N; ++j) sum += m[i][j];   // sequential: fast\nfor (int j = 0; j < N; ++j) for (int i = 0; i < N; ++i) sum += m[i][j];   // stride N*4 B: a miss per access for big N\n```\n\n2. **Temporal locality**: reuse data while it is hot; process in blocks (tiling) that fit in L1 (32-48 KB) or L2 (~1-2 MB).\n3. **Struct of arrays (SoA) vs array of structs (AoS)**: if a loop reads only `price` from 1M orders, an AoS of 64-B orders loads 64 B per 8-B price; SoA `std::vector<int64_t> prices` loads 8 prices per line and vectorises.\n4. **Avoid pointer chasing**: linked lists and trees cause dependent misses; prefer `std::vector`, flat hash maps, arrays.\n5. **Hot/cold splitting**: keep the fields used on the hot path together in one cache line; move the rest out.\n6. **Prefetching**: the hardware prefetcher handles sequential/strided access. For irregular access `__builtin_prefetch(ptr)` a few iterations ahead can help, measure first.\n7. **Cache warming**: in HFT the hot path may run rarely (only when a trade signal fires), so its code and data get evicted. Firms run the path with dummy data (\"warm-up\" or \"heartbeat\" orders that are not sent) to keep it in cache.\n8. **TLB**: 4 KiB pages; a big random-access table can miss in the TLB too. **Huge pages** (2 MiB) reduce TLB misses."
  },
  {
   "heading": "Memory alignment and padding",
   "body": "Each type has an alignment (`alignof(T)`): `int` 4, `double` 8, pointers 8 on x86-64. The compiler inserts **padding** so every member is aligned, and the struct size is a multiple of its largest alignment.\n\n```cpp\nstruct Bad  { char side; double price; char type; int qty; };  // 1+7pad +8 +1+3pad +4 = 24 B\nstruct Good { double price; int qty; char side; char type; };  // 8 +4 +1 +1 +2pad = 16 B\nstatic_assert(sizeof(Good) == 16);\n```\n\n- Order members **largest to smallest** to minimise padding; more objects per cache line = fewer misses.\n- `alignas(64)` puts an object at the start of a cache line, e.g. to avoid **false sharing** between data written by different threads. **In class:** the Lec-12 SPSC queue puts `alignas(64)` on `tail_` (written by the producer), `head_` (written by the consumer) and the slot array, so they are on separate lines. The file's header comment describes the \"planted bug\" version where `tail_` and `head_` are 8 bytes apart on the same line, which causes MESI ping-pong (visible in `perf c2c` as HITM). The code as committed already has the fix.\n- `std::hardware_destructive_interference_size` (C++17, `<new>`) is the portable constant (64 on x86-64; Intel's adjacent-line prefetcher sometimes makes 128 safer).\n- `#pragma pack(1)` / `__attribute__((packed))` remove padding (useful to overlay exchange wire formats) but members may be misaligned: slower access, and taking a reference/pointer to a misaligned member is dangerous. Copy wire data into aligned structs with `memcpy`.\n- A misaligned access that **crosses a cache-line boundary** costs two line accesses; atomics must be naturally aligned.\n- `std::aligned_alloc` / `new` with over-aligned types (C++17) give aligned heap memory."
  },
  {
   "heading": "Unsigned vs signed integers",
   "body": "| Aspect | Signed (`int`, `int64_t`) | Unsigned (`unsigned`, `size_t`) |\n|---|---|---|\n| Overflow | **Undefined behaviour** | Defined: wraps modulo 2^N |\n| Optimisation | The compiler may assume no overflow: e.g. `i + 1 > i` is always true, loop counters can be widened to 64-bit, trip counts computed | Wrap-around must be preserved, which can block some loop optimisations (a 32-bit unsigned index on a 64-bit machine) |\n| Division / modulo by 2^k | Needs a fix-up for negatives (`x / 2` is `shr`+`add`+`sar`) | Single shift / `and` |\n| Comparison | Natural | Mixing with signed converts the signed one: `-1 < 0u` is **false** |\n\n```cpp\nstd::vector<int> v;               // empty\nfor (int i = 0; i < v.size() - 1; ++i) { }  // v.size()-1 == SIZE_MAX: huge loop, out-of-bounds\nfor (size_t i = n; i >= 0; --i) { }         // infinite: an unsigned is always >= 0\n```\n\nGuidelines for low latency code:\n\n- Use **unsigned** for bit manipulation, masks, ring-buffer indices that are allowed to wrap (the class SPSC queue uses `std::size_t` head/tail that grow forever and are masked), and when you need `% 2^k` as `& mask`.\n- Use **signed** for arithmetic quantities (prices, P&L, differences, loop counters compared with arithmetic) unless you need the wrap.\n- Prefer a 64-bit index (`std::size_t` / `std::ptrdiff_t`) in loops over arrays on x86-64: no sign/zero extension per iteration.\n- Turn on `-Wall -Wextra -Wsign-compare`."
  },
  {
   "heading": "double vs float",
   "body": "| | `float` | `double` |\n|---|---|---|\n| Size | 4 B | 8 B |\n| Precision | ~7 significant decimal digits (24-bit mantissa) | ~15-16 digits (53-bit mantissa) |\n| Scalar add/mul latency on x86-64 (SSE/AVX) | Same as double (~4 cycles) | Same |\n| SIMD width (AVX2) | 8 per register | 4 per register |\n| Cache / memory | 2x more values per line | |\n| Division / sqrt | Somewhat faster | Slower |\n\n- `float` is faster mainly through **memory bandwidth, cache footprint and SIMD width**, not scalar arithmetic.\n- Watch silent **promotion**: `float x; x * 2.0` converts to double (`2.0` is a double literal) and back. Write `2.0f`. `std::sqrt(float)` picks the float overload; C `sqrt` takes a double.\n- `float` cannot represent integers above 2^24 = 16,777,216 exactly: a cumulative volume or a price in ticks in a float silently loses units.\n- For money and prices, use **integer ticks** (`int64_t`), not either floating type: exact, comparable, and integer ops are cheap.\n- `-ffast-math` lets the compiler reassociate and vectorise FP, at the cost of strict IEEE results."
  },
  {
   "heading": "const, constexpr and the compiler",
   "body": "- `const` on a local or a parameter is mostly for **correctness and readability**; the compiler already knows whether a local is modified. It rarely makes code faster by itself.\n- `const T&` does **not** let the compiler assume the object does not change: another non-const alias, or a `const_cast`, may modify it, so values are reloaded after unknown calls.\n- What does help: `constexpr` (value known at compile time, constant-folded, tables in `.rodata`), `const` / `constexpr` **globals** with constant initialisers (internal linkage, folded), `static constexpr` class members, `if constexpr`.\n- `const` member functions document that the object is not modified and allow calling on const objects.\n- `__restrict` and local copies (load a member into a local before a loop) give the compiler the aliasing guarantees `const` does not.\n\n```cpp\nvoid f(const int& limit, int* out, int n) {\n    for (int i = 0; i < n; ++i) out[i] = limit;   // limit reloaded each iteration: out[i] may alias limit\n}\nvoid g(int limit, int* out, int n) {           // by value: kept in a register, loop can be vectorised\n    for (int i = 0; i < n; ++i) out[i] = limit;\n}\n```"
  },
  {
   "heading": "Other low-latency hacks used in practice",
   "body": "- **No allocation on the hot path**: pre-allocate (pools, `reserve`, ring buffers) at startup.\n- **No syscalls on the hot path**: no `printf`, logging through an SPSC queue to a background thread, no `new`/`delete` that may call `mmap`/`brk`; kernel-bypass networking (e.g. user-space NIC drivers) avoids the socket syscalls entirely.\n- **Busy-poll** instead of blocking (condition variables and sleeps cost microseconds to wake).\n- **Pin threads** to isolated cores (`taskset`, `isolcpus`, `pthread_setaffinity_np`) so caches stay warm and the scheduler does not migrate them.\n- **Avoid exceptions and RTTI on the hot path**; use error codes for expected failures.\n- **Avoid `std::function`** (possible heap allocation, indirect call) and virtual dispatch in hot loops; use templates/lambdas.\n- **Avoid division and modulo** in hot code: power-of-two sizes and masks, multiply by reciprocal.\n- **Use the smallest adequate types** to pack more into each cache line (`uint32_t` qty if it fits, `uint8_t` side).\n- **Warm the cache** and the branch predictor by exercising the hot path regularly.\n- **Huge pages** for large tables; **pre-fault** memory (touch every page at startup, `mlock`) so no page faults occur during trading."
  },
  {
   "heading": "Quick revision",
   "body": "- Mispredict ~15-20 cycles; L1 ~1 ns, L2 ~4 ns, L3 ~10-20 ns, DRAM ~60-100 ns.\n- Hints (`[[likely]]`, `__builtin_expect`) mostly change code layout.\n- Keep cold error handling out of line (`[[gnu::cold]]`, noinline).\n- Multiple accumulators break dependency chains and expose ILP.\n- `&&`/`||` short-circuit = branches; `&`/`|` on bools can be branch-free.\n- Ternary on simple values usually becomes `cmov`.\n- `i & (N-1)` == `i % N` for power-of-two N (class SPSC `kMask`).\n- `x & (x-1)` clears the lowest set bit; power-of-two test `x && !(x & (x-1))`.\n- `__builtin_ctzll` / `popcount` are single instructions; ctz/clz of 0 is undefined.\n- Shift by >= bit width is UB.\n- C++ arrays are row-major: innermost loop over the last index.\n- SoA beats AoS when a loop touches few fields.\n- Order struct members largest to smallest to cut padding.\n- `alignas(64)` on per-thread written data prevents false sharing.\n- Signed overflow is UB (enables optimisations); unsigned wraps.\n- `-1 < 0u` is false; `v.size() - 1` on an empty vector is huge.\n- float = 7 digits, double = 15-16; float's win is memory and SIMD width; use `2.0f` literals.\n- Prices as integer ticks.\n- `const&` does not prevent aliasing; pass small values by value."
  },
  {
   "heading": "Exam traps",
   "body": "- \"Branchless is always faster\": no; predictable branches are nearly free.\n- \"`[[likely]]` makes the CPU predict the branch\": not directly; it changes layout. Modern x86 has no static hint prefixes that matter.\n- `1 << 31` with `int` overflows; `1u << 32` is UB; write `1ULL << k`.\n- `x % 8` for a **signed** negative x is negative (`-9 % 8 == -1`), so it is not the same as `x & 7` (which gives 7).\n- `for (unsigned i = n - 1; i >= 0; --i)` never ends.\n- Comparing `int` with `size_t` silently converts the int to unsigned.\n- Using `float` for cumulative volume loses exactness above 16,777,216.\n- `float f = 0.1; if (f == 0.1)` is false: `0.1` is a double, `f` holds the float rounding.\n- `#pragma pack(1)` saves space but makes members misaligned; do not take pointers to them or use them as atomics.\n- The XOR swap is slower than `std::swap` and fails when both refer to the same object (it zeroes it).\n- `const` does not make a reference parameter immune to aliasing, so it does not enable the same optimisations as passing by value.\n- Reading the class `spsc_queue.hpp`: the header comment calls `head_`/`tail_` sharing a line the \"planted bug\", but the committed code already separates them with `alignas(64)`."
  }
 ],
 "keyTerms": [
  {
   "term": "Pipeline",
   "def": "Overlapping fetch, decode, execute and retire stages so several instructions are in flight at once."
  },
  {
   "term": "Branch predictor",
   "def": "Hardware that guesses branch direction and target so fetching can continue before the branch resolves."
  },
  {
   "term": "BTB",
   "def": "Branch target buffer: caches the target addresses of taken branches."
  },
  {
   "term": "Misprediction penalty",
   "def": "~15-20 cycles lost flushing and refilling the pipeline after a wrong guess."
  },
  {
   "term": "Instruction-level parallelism",
   "def": "Independent instructions executing in parallel on the out-of-order core."
  },
  {
   "term": "__builtin_expect",
   "def": "GCC/Clang hint giving the expected value of a condition, used for code layout."
  },
  {
   "term": "cmov",
   "def": "Conditional move: branch-free selection between two values."
  },
  {
   "term": "Short-circuit evaluation",
   "def": "&& and || skip the right operand when the result is already known, which requires a branch."
  },
  {
   "term": "Power-of-two mask",
   "def": "i & (N - 1) computes i % N for unsigned i when N is a power of two."
  },
  {
   "term": "popcount / ctz / clz",
   "def": "Count set bits, count trailing zeros, count leading zeros: single-instruction bit operations."
  },
  {
   "term": "Row-major order",
   "def": "C++ multi-dimensional arrays store each row contiguously; iterate the last index innermost."
  },
  {
   "term": "SoA vs AoS",
   "def": "Struct of arrays stores each field contiguously; array of structs stores whole objects contiguously."
  },
  {
   "term": "Padding",
   "def": "Unused bytes inserted by the compiler to keep members aligned."
  },
  {
   "term": "alignas",
   "def": "Specifier that forces a minimum alignment, e.g. alignas(64) for cache-line alignment."
  },
  {
   "term": "False sharing",
   "def": "Threads writing different variables on the same cache line, causing the line to bounce between cores."
  },
  {
   "term": "Signed overflow",
   "def": "Undefined behaviour in C++, which lets the compiler assume it never happens."
  },
  {
   "term": "Unsigned wrap-around",
   "def": "Unsigned arithmetic is defined modulo 2^N."
  },
  {
   "term": "Float precision",
   "def": "float has ~7 significant decimal digits; double ~15-16."
  },
  {
   "term": "Cache warming",
   "def": "Regularly exercising the hot path so its code and data stay in cache."
  },
  {
   "term": "Huge pages",
   "def": "2 MiB (or 1 GiB) pages that cut TLB misses for large data."
  }
 ],
 "mcqs": [
  {
   "q": "Roughly how many cycles does a branch misprediction cost on a modern x86 core?",
   "options": [
    "1-2",
    "15-20",
    "200-300",
    "About 10,000"
   ],
   "answer": 1,
   "explanation": "The pipeline (~15-20 stages from fetch to execute) is flushed and refilled.",
   "distractors": "1-2 is a predicted branch, 200-300 is a DRAM miss, 10,000 is syscall/context-switch scale.",
   "source": "lecture",
   "id": "L13-m1"
  },
  {
   "q": "What do `[[likely]]` / `__builtin_expect` mainly do on x86-64?",
   "options": [
    "Change code layout so the expected path is the fall-through and cold code is moved away",
    "Program the hardware branch predictor directly",
    "Make the branch execute in zero cycles",
    "Convert the branch into a cmov"
   ],
   "answer": 0,
   "explanation": "They are compiler hints for block placement and inlining; the dynamic predictor learns on its own.",
   "distractors": "x86 has no effective static prediction hints today; they do not make branches free or force cmov.",
   "source": "lecture",
   "id": "L13-m2"
  },
  {
   "q": "Which loop summing a 4096x4096 `int m[N][N]` is faster, and why?\n    A: for i { for j { s += m[i][j]; } }\n    B: for j { for i { s += m[i][j]; } }",
   "options": [
    "B, because it accesses columns",
    "Both are the same: the compiler reorders loops always",
    "B, because it has fewer cache lines",
    "A, because C++ arrays are row-major so the inner loop walks memory sequentially"
   ],
   "answer": 3,
   "explanation": "A reads consecutive addresses (16 ints per 64-B line), B jumps 16 KB each step, missing the cache on almost every access.",
   "distractors": "Compilers may interchange loops but cannot be relied on; B touches far more lines.",
   "source": "lecture",
   "id": "L13-m3"
  },
  {
   "q": "What does `x & (x - 1)` compute for an unsigned x?",
   "options": [
    "x rounded to a power of two",
    "The lowest set bit of x",
    "x with its lowest set bit cleared",
    "x minus one"
   ],
   "answer": 2,
   "explanation": "Subtracting 1 flips the lowest set bit and the zeros below it; AND clears that bit. It is 0 exactly when x is a power of two (or 0).",
   "distractors": "Isolating the lowest set bit is x & -x; the others are unrelated.",
   "source": "lecture",
   "id": "L13-m4"
  },
  {
   "q": "In class, the SPSC queue computes `slots_[t & kMask]` with `kMask = Capacity - 1`. Why must Capacity be a power of two?",
   "options": [
    "So that the array is cache-aligned",
    "Because `t & (Capacity - 1)` equals `t % Capacity` only for powers of two, giving a single AND instead of a division",
    "So that the atomics are lock-free",
    "Because std::array requires it"
   ],
   "answer": 1,
   "explanation": "For N = 2^k, N - 1 is a mask of k low bits. The class code enforces it with static_assert((Capacity & (Capacity - 1)) == 0).",
   "distractors": "Alignment comes from alignas, std::array accepts any size, and lock-freedom depends on the atomic type.",
   "source": "lecture",
   "id": "L13-m5"
  },
  {
   "q": "Which of these is undefined behaviour for `int x = INT_MAX;`?",
   "options": [
    "x + 1",
    "x - 1",
    "(unsigned)x + 1u",
    "x / 2"
   ],
   "answer": 0,
   "explanation": "Signed overflow is UB. Converting to unsigned and adding is defined wrap-around.",
   "distractors": "x - 1 and x / 2 stay in range; unsigned arithmetic never overflows in the UB sense.",
   "source": "lecture",
   "id": "L13-m6"
  },
  {
   "q": "What does this print?\n    int a = -1; unsigned b = 1;\n    std::cout << (a < b);",
   "options": [
    "1",
    "Compile error",
    "Undefined behaviour",
    "0"
   ],
   "answer": 3,
   "explanation": "a is converted to unsigned (UINT_MAX), so UINT_MAX < 1 is false and 0 is printed (with a -Wsign-compare warning).",
   "distractors": "It compiles, the conversion is well defined, and the 'obvious' answer 1 ignores the usual arithmetic conversions.",
   "source": "lecture",
   "id": "L13-m7"
  },
  {
   "q": "What is wrong with `for (int i = 0; i < v.size() - 1; ++i)` when v is empty?",
   "options": [
    "Nothing; the loop runs zero times",
    "It does not compile",
    "v.size() - 1 wraps to SIZE_MAX, so the loop runs far beyond the vector and reads out of bounds",
    "It loops exactly once"
   ],
   "answer": 2,
   "explanation": "size() is size_t, so 0 - 1 wraps to the maximum value.",
   "distractors": "It compiles and the loop does not stop at 0 or 1 iterations.",
   "source": "lecture",
   "id": "L13-m8"
  },
  {
   "q": "Why can the compiler optimise `for (int i = 0; i <= n; ++i)` better than the same loop with `unsigned i`?",
   "options": [
    "Signed integers are faster to add",
    "Signed overflow is UB, so the compiler may assume i never wraps and can compute the trip count and widen i",
    "Unsigned loops cannot be vectorised at all",
    "There is no difference"
   ],
   "answer": 1,
   "explanation": "With unsigned i, n == UINT_MAX would make the loop infinite (wrap is defined), so the compiler must handle that case.",
   "distractors": "Additions cost the same, unsigned loops can often be vectorised, and the difference is real in some loops.",
   "source": "lecture",
   "id": "L13-m9"
  },
  {
   "q": "`float f = 0.1; if (f == 0.1) puts(\"eq\"); else puts(\"ne\");` prints:",
   "options": [
    "ne",
    "Undefined behaviour",
    "Compile error",
    "eq"
   ],
   "answer": 0,
   "explanation": "0.1 is a double; f stores the nearest float, which when promoted back to double differs from the double 0.1.",
   "distractors": "The code is valid and well defined; the comparison is simply false.",
   "source": "lecture",
   "id": "L13-m10"
  },
  {
   "q": "What is the main performance advantage of float over double in numeric loops on x86-64?",
   "options": [
    "Scalar float addition has half the latency of double",
    "float operations never round",
    "float avoids the FPU",
    "Twice as many values per SIMD register and per cache line, halving memory traffic"
   ],
   "answer": 3,
   "explanation": "Scalar add/mul latency is the same; the gain comes from bandwidth and vector width (8 vs 4 per AVX2 register).",
   "distractors": "Both use SSE/AVX registers, and both round.",
   "source": "lecture",
   "id": "L13-m11"
  },
  {
   "q": "Above which integer can a `float` no longer represent every integer exactly?",
   "options": [
    "2^53",
    "2^31",
    "2^24 = 16,777,216",
    "65,535"
   ],
   "answer": 2,
   "explanation": "float has a 24-bit significand; beyond 2^24 odd integers are not representable.",
   "distractors": "2^53 is the limit for double; 2^31 and 65,535 are integer-type limits.",
   "source": "lecture",
   "id": "L13-m12"
  },
  {
   "q": "What is `sizeof(S)` on x86-64?\n    struct S { char a; double b; char c; };",
   "options": [
    "10",
    "24",
    "16",
    "17"
   ],
   "answer": 1,
   "explanation": "a at 0, 7 bytes padding, b at 8-15, c at 16, then 7 bytes tail padding to a multiple of 8: 24.",
   "distractors": "Reordering to {double; char; char} would give 16; 10 and 17 ignore alignment.",
   "source": "lecture",
   "id": "L13-m13"
  },
  {
   "q": "Which member order minimises padding for {char side; int64_t px; int32_t qty; char type;}?",
   "options": [
    "int64_t px; int32_t qty; char side; char type;",
    "char side; int64_t px; char type; int32_t qty;",
    "char side; char type; int64_t px; int32_t qty; with #pragma pack removed",
    "The order never affects size"
   ],
   "answer": 0,
   "explanation": "Largest to smallest: 8 + 4 + 1 + 1 + 2 padding = 16 B, vs 24 B for the others.",
   "distractors": "The first and third leave holes before px and a tail pad; order does affect size.",
   "source": "lecture",
   "id": "L13-m14"
  },
  {
   "q": "Why does the class SPSC queue put `alignas(64)` on both `tail_` and `head_`?",
   "options": [
    "To make the atomics lock-free",
    "To reduce memory use",
    "Because std::atomic requires 64-byte alignment",
    "So that the producer-written and consumer-written indices are on different cache lines, avoiding false sharing"
   ],
   "answer": 3,
   "explanation": "If both indices share a line, each write by one core invalidates the other core's copy (MESI ping-pong).",
   "distractors": "Lock-freedom does not need 64-B alignment, atomics only need natural alignment, and padding increases memory use.",
   "source": "lecture",
   "id": "L13-m15"
  },
  {
   "q": "Is `1u << 32` valid when `unsigned` is 32 bits?",
   "options": [
    "Yes, it gives 0",
    "Yes, it gives 1",
    "No, shifting by >= the bit width is undefined behaviour",
    "Yes, it gives 2^32"
   ],
   "answer": 2,
   "explanation": "The shift count must be less than the width of the promoted left operand. (x86 masks the count to 5 bits, so in practice it often gives 1, but that is not guaranteed.)",
   "distractors": "0 and 1 are possible outcomes of UB, not defined results; 2^32 does not fit in 32 bits.",
   "source": "lecture",
   "id": "L13-m16"
  },
  {
   "q": "What does `-9 % 8` evaluate to in C++, and is it the same as `-9 & 7`?",
   "options": [
    "7; yes",
    "-1; no, -9 & 7 is 7",
    "1; no",
    "-1; yes"
   ],
   "answer": 1,
   "explanation": "Integer division truncates toward zero, so the remainder takes the sign of the dividend: -1. The mask gives 7 in two's complement.",
   "distractors": "The mask trick only matches % for non-negative (or unsigned) values.",
   "source": "lecture",
   "id": "L13-m17"
  },
  {
   "q": "Why can the branchy version of `if (err) handle(); else fast();` be faster than a branchless rewrite?",
   "options": [
    "If err is almost never true the branch is predicted perfectly, while branchless code computes both paths every time",
    "Branchless code cannot be inlined",
    "Branches are always free",
    "cmov is slower than a mispredicted branch"
   ],
   "answer": 0,
   "explanation": "A well predicted branch costs ~0 cycles; branchless pays for both sides and adds a data dependency.",
   "distractors": "Branches are only free when predicted; branchless code can be inlined; cmov is cheaper than a mispredict.",
   "source": "lecture",
   "id": "L13-m18"
  },
  {
   "q": "Which operator pair evaluates both operands without short-circuiting, allowing branch-free combination of two cheap bool conditions?",
   "options": [
    "&& and ||",
    "== and !=",
    "?: and ,",
    "& and |"
   ],
   "answer": 3,
   "explanation": "Bitwise & and | on bool evaluate both sides; && and || skip the second and usually need a branch.",
   "distractors": "?: selects, the comma operator sequences, and == / != compare rather than combine.",
   "source": "lecture",
   "id": "L13-m19"
  },
  {
   "q": "A loop sums 1M doubles with one accumulator `s += a[i]`; FP add latency is 4 cycles and throughput 2 per cycle. What most likely speeds it up without -ffast-math changes of semantics you did not intend?",
   "options": [
    "Using `volatile double s`",
    "Making the loop index unsigned",
    "Manually using 4-8 independent accumulators (changing summation order deliberately)",
    "Adding [[likely]] to the loop"
   ],
   "answer": 2,
   "explanation": "One accumulator is a latency-bound dependency chain; several accumulators let the core overlap adds (you accept a different rounding order explicitly).",
   "distractors": "volatile adds memory traffic, index signedness does not affect the FP chain, and [[likely]] does not apply.",
   "source": "lecture",
   "id": "L13-m20"
  },
  {
   "q": "Which is the safest way to read a packed, possibly misaligned `int64_t` price from a raw network buffer `const char* p`?",
   "options": [
    "`int64_t px = *reinterpret_cast<const int64_t*>(p);`",
    "`int64_t px; std::memcpy(&px, p, sizeof px);`",
    "`int64_t px = *(int64_t*)p;` with -O0",
    "`int64_t px = (int64_t)*p;`"
   ],
   "answer": 1,
   "explanation": "memcpy is defined for any alignment and type, and compilers turn it into a single load on x86.",
   "distractors": "The casts violate alignment/strict-aliasing rules (UB); casting *p converts one char, not eight bytes.",
   "source": "lecture",
   "id": "L13-m21"
  },
  {
   "q": "Why does `const int& limit` in `for (...) out[i] = limit;` (with `int* out`) prevent some optimisations that passing `int limit` by value allows?",
   "options": [
    "out[i] might alias limit, so the compiler must reload it each iteration; a by-value copy lives in a register",
    "const references are always slower to read",
    "const references cannot be inlined",
    "The const is ignored by the compiler entirely, causing UB"
   ],
   "answer": 0,
   "explanation": "const only forbids modification through that reference, not through other pointers like out.",
   "distractors": "A reference read itself is a normal load, inlining is unaffected, and there is no UB.",
   "source": "lecture",
   "id": "L13-m22"
  }
 ],
 "msqs": [
  {
   "q": "Which of the following are undefined behaviour in C++? (select all that apply)",
   "options": [
    "Signed integer overflow (INT_MAX + 1)",
    "Unsigned integer overflow (UINT_MAX + 1u)",
    "Shifting a 32-bit value by 32",
    "Reading an int64_t through a misaligned reinterpret_cast pointer",
    "Converting -1 to unsigned"
   ],
   "answers": [
    0,
    2,
    3
   ],
   "explanation": "Signed overflow, over-wide shifts and misaligned/aliasing-violating accesses are UB. Unsigned arithmetic wraps by definition, and converting -1 to unsigned is defined (UINT_MAX).",
   "id": "L13-x1"
  },
  {
   "q": "Which statements about branch prediction are true? (select all that apply)",
   "options": [
    "Random data-dependent branches mispredict often",
    "A loop branch taken 1000 times then not taken is predicted well",
    "Virtual calls use an indirect branch predictor",
    "Mispredictions only cost one cycle",
    "Sorting data can make a threshold branch predictable"
   ],
   "answers": [
    0,
    1,
    2,
    4
   ],
   "explanation": "Random branches defeat prediction, loop branches and sorted data are easy patterns, and indirect calls have their own predictor. A mispredict costs ~15-20 cycles.",
   "id": "L13-x2"
  },
  {
   "q": "Which are valid branch-free ways to write `x > 0 ? x : 0` for an int? (select all that apply)",
   "options": [
    "`x & -(x > 0)`",
    "`std::max(x, 0)` (typically cmov or max instruction)",
    "`(x > 0) * x`",
    "`if (x > 0) return x; return 0;` guaranteed branch-free"
   ],
   "answers": [
    0,
    1,
    2
   ],
   "explanation": "The mask trick, std::max and multiplying by the bool are branch-free formulations. An if statement may or may not become cmov; nothing guarantees it.",
   "id": "L13-x3"
  },
  {
   "q": "Which bit tricks are correct for an unsigned 64-bit x? (select all that apply)",
   "options": [
    "`x & (x - 1)` clears the lowest set bit",
    "`x && !(x & (x - 1))` is true iff x is a power of two",
    "`x & -x` isolates the lowest set bit",
    "`__builtin_ctzll(0)` returns 64",
    "`x >> 64` returns 0"
   ],
   "answers": [
    0,
    1,
    2
   ],
   "explanation": "The first three are standard identities. ctz of 0 is undefined for the builtin (std::countr_zero(0) returns 64), and shifting by 64 is UB.",
   "id": "L13-x4"
  },
  {
   "q": "For a power-of-two capacity N and an unsigned index i, which expressions equal `i % N`? (select all that apply)",
   "options": [
    "`i & (N - 1)`",
    "`i - (i / N) * N`",
    "`i & N`",
    "`i >> N`"
   ],
   "answers": [
    0,
    1
   ],
   "explanation": "The mask keeps the low bits, and i - (i/N)*N is the definition of remainder. `i & N` tests one bit, and `i >> N` divides by 2^N.",
   "id": "L13-x5"
  },
  {
   "q": "Which statements about cache optimisation are true? (select all that apply)",
   "options": [
    "A cache line on x86-64 is 64 bytes",
    "Struct-of-arrays layout helps when a loop reads only one field of many objects",
    "Linked lists are prefetcher-friendly",
    "Iterating the last index innermost is fast for C++ 2-D arrays",
    "Hot/cold splitting keeps frequently used fields in fewer cache lines"
   ],
   "answers": [
    0,
    1,
    3,
    4
   ],
   "explanation": "64-B lines, SoA for field-wise loops, row-major traversal and hot/cold splitting all improve locality. Linked lists cause dependent pointer-chasing loads the prefetcher cannot predict.",
   "id": "L13-x6"
  },
  {
   "q": "Which of these reduce padding or cache footprint of an order struct? (select all that apply)",
   "options": [
    "Ordering members from largest to smallest alignment",
    "Using uint8_t for side instead of int",
    "Adding alignas(64) to every member",
    "Moving rarely used fields to a separate cold struct",
    "Using double instead of int32_t for quantity"
   ],
   "answers": [
    0,
    1,
    3
   ],
   "explanation": "Reordering, smaller types and hot/cold splitting all shrink the hot struct. alignas(64) on every member would blow each one up to a cache line, and a double is larger than int32_t.",
   "id": "L13-x7"
  },
  {
   "q": "Which statements about false sharing are true? (select all that apply)",
   "options": [
    "It happens when threads write different variables on the same cache line",
    "It is fixed by putting the variables on separate cache lines (alignas(64) / padding)",
    "It requires the threads to write the same variable",
    "It shows up as HITM events in perf c2c",
    "It only affects single-threaded code"
   ],
   "answers": [
    0,
    1,
    3
   ],
   "explanation": "False sharing is line-level contention between distinct variables, cured by separating them, and perf c2c reports it as HITM. Writing the same variable is true sharing, and single-threaded code cannot have it.",
   "id": "L13-x8"
  },
  {
   "q": "Which statements about signed and unsigned integers are true? (select all that apply)",
   "options": [
    "Unsigned arithmetic wraps modulo 2^N",
    "Signed overflow lets the compiler assume `i + 1 > i`",
    "`-1 < 0u` evaluates to true",
    "Unsigned division by a power of two is a single shift",
    "A loop `for (unsigned i = n; i >= 0; --i)` terminates"
   ],
   "answers": [
    0,
    1,
    3
   ],
   "explanation": "Unsigned wraps, signed overflow is UB so the compiler can assume no overflow, and unsigned /2^k is a shift. -1 converts to UINT_MAX so the comparison is false, and an unsigned is always >= 0, so the loop never ends.",
   "id": "L13-x9"
  },
  {
   "q": "Which statements comparing float and double are true? (select all that apply)",
   "options": [
    "float has about 7 significant decimal digits",
    "An AVX2 register holds 8 floats or 4 doubles",
    "Scalar float addition has much lower latency than double on x86-64",
    "`x * 2.0` with a float x promotes the multiplication to double",
    "float can exactly represent every integer up to 2^31"
   ],
   "answers": [
    0,
    1,
    3
   ],
   "explanation": "float has 24-bit precision (~7 digits), SIMD width doubles with float, and 2.0 is a double literal causing promotion. Scalar latencies are the same, and float is exact only up to 2^24.",
   "id": "L13-x10"
  },
  {
   "q": "Which statements about const are true? (select all that apply)",
   "options": [
    "const on a reference parameter does not stop other aliases from modifying the object",
    "constexpr values can be folded at compile time",
    "Marking every local variable const typically makes the code much faster",
    "A const member function can be called on a const object",
    "`const int x = read_input();` is a compile-time constant"
   ],
   "answers": [
    0,
    1,
    3
   ],
   "explanation": "const& only restricts that access path, constexpr enables folding, and const member functions work on const objects. const locals rarely change codegen, and a const initialised at runtime is not a constant expression.",
   "id": "L13-x11"
  },
  {
   "q": "Which practices keep syscalls and allocation off the HFT hot path? (select all that apply)",
   "options": [
    "Logging through an SPSC queue to a background thread",
    "Pre-allocating object pools at startup",
    "Calling printf for every order",
    "Using busy-polling instead of blocking waits",
    "Pre-faulting and locking memory pages at startup"
   ],
   "answers": [
    0,
    1,
    3,
    4
   ],
   "explanation": "Asynchronous logging, pools, busy-polling and pre-faulting all avoid kernel calls or page faults while trading. printf on the hot path does formatting and write syscalls.",
   "id": "L13-x12"
  },
  {
   "q": "Which statements about short-circuit operators are true? (select all that apply)",
   "options": [
    "`a && b` does not evaluate b if a is false",
    "`&&` typically compiles to a conditional branch",
    "`a & b` on bools always short-circuits",
    "`p && p->qty > 0` is safe for a null p",
    "`a | b` on bools evaluates both operands"
   ],
   "answers": [
    0,
    1,
    3,
    4
   ],
   "explanation": "&& and || skip the right operand (hence branches and the null-check idiom), while & and | evaluate both sides. Bitwise & never short-circuits.",
   "id": "L13-x13"
  },
  {
   "q": "Which techniques help break a long dependency chain in a hot reduction loop? (select all that apply)",
   "options": [
    "Multiple independent accumulators",
    "Vectorisation (SIMD lanes act as separate accumulators)",
    "Declaring the accumulator volatile",
    "Unrolling the loop together with separate partial sums",
    "Adding more branches inside the loop"
   ],
   "answers": [
    0,
    1,
    3
   ],
   "explanation": "Independent partial sums, SIMD lanes and unrolling with separate sums let additions overlap. volatile forces memory round-trips, and extra branches add nothing to parallelism.",
   "id": "L13-x14"
  }
 ],
 "short": [
  {
   "q": "Explain why branch mispredictions are expensive and give two techniques to reduce their cost on a hot path, with code.",
   "checks": [
    {
     "label": "Pipeline flush / refill",
     "patterns": [
      "pipeline",
      "flush"
     ]
    },
    {
     "label": "Cost ~15-20 cycles",
     "patterns": [
      "1[5-9]",
      "20 cycles",
      "cycles"
     ]
    },
    {
     "label": "Branchless technique (cmov/ternary/mask)",
     "patterns": [
      "cmov",
      "branchless",
      "mask"
     ]
    },
    {
     "label": "Layout hints or predictability technique",
     "patterns": [
      "likely",
      "__builtin_expect",
      "sort",
      "cold"
     ]
    }
   ],
   "modelAnswer": "The CPU pipeline fetches and executes instructions speculatively along the predicted path. If the prediction is wrong, all speculative work after the branch is thrown away and the pipeline is flushed and refilled from the correct address: about 15-20 cycles (~5 ns at 4 GHz), during which no useful work retires. On random data-dependent branches that can happen every other iteration.\n\nTechniques:\n\n1. Branchless code with a conditional move or mask when the condition is unpredictable:\n\n```cpp\nlong sum = 0;\nfor (int x : v) sum += (x >= 128) ? x : 0;   // cmp + cmov (or vectorised), no branch\n```\n\n2. Make the common path predictable and straight-line, and push rare work out of line:\n\n```cpp\nif (__builtin_expect(msg.seq != expected, 0)) [[unlikely]] { handle_gap(msg); return; }  // cold\napply(msg);                                   // hot fall-through path\n```\n\nAlso: sort/partition data so the branch becomes predictable, hoist loop-invariant conditions out of loops, and replace if-else chains with lookup tables.",
   "explanation": "Pipeline mechanics plus at least one branchless and one layout/predictability technique.",
   "id": "L13-s1"
  },
  {
   "q": "Given `struct Order { char side; double price; int qty; char type; long id; };` on x86-64, compute its size, explain the padding, and rewrite it to be smaller.",
   "checks": [
    {
     "label": "Original size 32",
     "patterns": [
      "32"
     ]
    },
    {
     "label": "Explains alignment/padding",
     "patterns": [
      "pad",
      "align"
     ]
    },
    {
     "label": "Reorders largest to smallest",
     "patterns": [
      "largest",
      "descending",
      "reorder"
     ]
    },
    {
     "label": "New size 24",
     "patterns": [
      "24"
     ]
    }
   ],
   "modelAnswer": "Layout of the original (alignments: char 1, int 4, double 8, long 8):\n\n- `side` at 0, then 7 bytes of padding so `price` is 8-aligned\n- `price` at 8-15\n- `qty` at 16-19\n- `type` at 20, then 3 bytes padding so `id` is 8-aligned\n- `id` at 24-31\n\n`sizeof(Order) == 32`, with 10 bytes of padding.\n\nReorder members from largest to smallest alignment:\n\n```cpp\nstruct Order { double price; long id; int qty; char side; char type; };  // 8 + 8 + 4 + 1 + 1 + 2 tail pad\nstatic_assert(sizeof(Order) == 24);\n```\n\nNow it is 24 bytes, so more orders fit per 64-B cache line and fewer misses occur. Using `int64_t` ticks for price and `uint8_t` enums keeps the same layout with clearer types.",
   "explanation": "Correct offset arithmetic and the largest-first rule.",
   "id": "L13-s2"
  },
  {
   "q": "Explain the signed vs unsigned trade-offs for low-latency code and find the bug: `for (int i = 0; i < v.size() - 1; ++i) if (v[i] > v[i+1]) ++inversions;`",
   "checks": [
    {
     "label": "Signed overflow is UB / allows optimisation",
     "patterns": [
      "undefined",
      "\\bUB\\b"
     ]
    },
    {
     "label": "Unsigned wraps",
     "patterns": [
      "wrap",
      "modulo"
     ]
    },
    {
     "label": "Empty vector: size()-1 wraps huge",
     "patterns": [
      "SIZE_MAX",
      "huge",
      "empty",
      "wraps? (around )?to"
     ]
    },
    {
     "label": "Fix given",
     "patterns": [
      "i \\+ 1 < v\\.size\\(\\)",
      "v\\.empty\\(\\)",
      "ssize",
      "static_cast"
     ]
    }
   ],
   "modelAnswer": "Trade-offs: signed overflow is undefined behaviour (UB), so the compiler may assume it never happens: it can compute trip counts, widen a 32-bit loop counter to 64-bit, and simplify `i + 1 > i` to true. Unsigned arithmetic wraps modulo 2^N, which is well defined and great for masks, bit tricks and ring-buffer indices (`i & (N-1)`), and division/modulo by 2^k is a single shift/and. But wrap-around semantics can block some loop optimisations, and mixing signed with unsigned converts the signed value to unsigned (`-1 < 0u` is false).\n\nThe bug: `v.size()` is `size_t`. If `v` is empty, `v.size() - 1` wraps to SIZE_MAX, so the loop runs far past the end and reads out of bounds (UB). It also compares `int` with `size_t` (sign-compare warning), and for sizes above INT_MAX `i` would overflow.\n\nFix:\n\n```cpp\nfor (std::size_t i = 0; i + 1 < v.size(); ++i)\n    if (v[i] > v[i + 1]) ++inversions;\n```\n\n(or check `v.empty()` first, or use `std::ssize(v)` in C++20.)",
   "explanation": "UB vs wrap semantics and the classic size()-1 underflow.",
   "id": "L13-s3"
  },
  {
   "q": "When is float preferable to double in a trading system, and when is neither appropriate? Mention precision and performance.",
   "checks": [
    {
     "label": "Precision digits",
     "patterns": [
      "7 (significant )?digits",
      "~7",
      "15",
      "16"
     ]
    },
    {
     "label": "SIMD / memory advantage of float",
     "patterns": [
      "SIMD",
      "vector",
      "cache",
      "bandwidth",
      "memory"
     ]
    },
    {
     "label": "Scalar arithmetic is same speed",
     "patterns": [
      "same (latency|speed)",
      "not faster",
      "scalar"
     ]
    },
    {
     "label": "Integer ticks for prices/money",
     "patterns": [
      "integer",
      "ticks",
      "int64"
     ]
    },
    {
     "label": "Promotion or 2^24 pitfall",
     "patterns": [
      "promot",
      "2\\.0f",
      "16,?777,?216",
      "2\\^24"
     ]
    }
   ],
   "modelAnswer": "float has ~7 significant digits (24-bit mantissa); double has ~15-16 digits. On x86-64 scalar float and double add/multiply have the same latency, so float is not faster for scalar code. float wins when you process large arrays: it halves memory and cache footprint and doubles SIMD width (8 floats vs 4 doubles per AVX2 register), e.g. large signal/feature vectors, ML inference, or Monte Carlo where 7 digits is enough.\n\nPrefer double for anything accumulating (P&L, volatility, sums over many values), since float error grows quickly and float cannot represent integers above 2^24 = 16,777,216 exactly. Watch promotion: `f * 2.0` is a double operation; write `2.0f`.\n\nFor prices, quantities and money use neither: store them as integer ticks (`int64_t`), which are exact, safe as map keys and cheap to compare.",
   "explanation": "Know where the float speed-up actually comes from and why prices are integers.",
   "id": "L13-s4"
  },
  {
   "q": "Explain false sharing using the class SPSC queue (head_ and tail_) and show how the code avoids it.",
   "checks": [
    {
     "label": "Same cache line, different variables",
     "patterns": [
      "same (64[- ]byte )?cache line",
      "same line"
     ]
    },
    {
     "label": "Producer writes tail, consumer writes head",
     "patterns": [
      "producer.*tail",
      "tail.*producer"
     ]
    },
    {
     "label": "MESI invalidation / ping-pong",
     "patterns": [
      "MESI",
      "invalidat",
      "ping[- ]pong"
     ]
    },
    {
     "label": "alignas(64) fix",
     "patterns": [
      "alignas\\(64\\)"
     ]
    },
    {
     "label": "Detect with perf c2c / HITM",
     "patterns": [
      "perf c2c",
      "HITM"
     ]
    }
   ],
   "modelAnswer": "In the SPSC ring buffer the producer thread only writes `tail_` and the consumer thread only writes `head_`. If the two `std::atomic<size_t>` indices are declared back to back they are 8 bytes apart, on the same 64-byte cache line. Under the MESI protocol a core must own a line in Modified state to write it, so each push invalidates the consumer's copy and each pop invalidates the producer's copy: the line ping-pongs between cores (~50-100+ ns per transfer) even though the threads never touch the same variable. That is false sharing.\n\nThe class header calls this the planted bug and says `perf c2c` shows it as HITM traffic (loads hitting a Modified line in another core).\n\nThe fix, which the committed class code uses:\n\n```cpp\nalignas(64) std::atomic<std::size_t> tail_{0};   // producer's line\nalignas(64) std::atomic<std::size_t> head_{0};   // consumer's line\nalignas(64) std::array<T, Capacity> slots_;      // buffer starts on its own line\n```\n\nEach index now has its own cache line. (Portable: `std::hardware_destructive_interference_size`.) A further optimisation caches the other side's index locally so each thread reads the remote line only when its cached copy says the queue looks full or empty.",
   "explanation": "Link false sharing to MESI and the concrete class fix.",
   "id": "L13-s5"
  },
  {
   "q": "Give three bit-manipulation tricks useful in low-latency code, with code, and one bit-shift rule that is undefined behaviour.",
   "checks": [
    {
     "label": "Power-of-two mask modulo",
     "patterns": [
      "& ?\\(N ?- ?1\\)",
      "kMask",
      "mask"
     ]
    },
    {
     "label": "Lowest set bit / power-of-two test",
     "patterns": [
      "x & \\(x ?- ?1\\)",
      "x & -x"
     ]
    },
    {
     "label": "ctz/clz/popcount",
     "patterns": [
      "ctz",
      "clz",
      "popcount"
     ]
    },
    {
     "label": "UB rule for shifts",
     "patterns": [
      "bit width",
      ">= ?(the )?width",
      "shift(ing)? by (32|64)"
     ]
    }
   ],
   "modelAnswer": "1. Modulo by a power of two with a mask (the class SPSC queue: `slots_[t & kMask]`, `kMask = Capacity - 1`):\n\n```cpp\nstatic_assert((N & (N - 1)) == 0);\nstd::size_t slot = i & (N - 1);   // == i % N, one AND instead of a ~25-cycle div\n```\n\n2. Power-of-two test and lowest set bit:\n\n```cpp\nbool pow2 = x && !(x & (x - 1));   // x & (x-1) clears the lowest set bit\nstd::uint64_t low = x & -x;        // isolates the lowest set bit\n```\n\n3. Find the next non-empty price level from a 64-bit bitmap with one instruction:\n\n```cpp\nint next = mask ? __builtin_ctzll(mask) : -1;   // also clz, popcount; std::countr_zero in C++20\n```\n\nUB rule: shifting by a count greater than or equal to the bit width of the (promoted) operand, e.g. `1u << 32` for a 32-bit unsigned, is undefined behaviour. Also `1 << 31` overflows a signed 32-bit int (use `1u` or `1ULL`), and `__builtin_ctzll(0)` is undefined.",
   "explanation": "Concrete, correct tricks plus awareness of shift UB.",
   "id": "L13-s6"
  }
 ],
 "quiz": [],
 "coding": [
  {
   "id": "spsc-ring-buffer",
   "title": "SPSC Lock-Free Ring Buffer"
  }
 ],
 "prev": {
  "num": 12,
  "file": "lecture-12.html"
 },
 "next": {
  "num": 14,
  "file": "lecture-14.html"
 }
};
