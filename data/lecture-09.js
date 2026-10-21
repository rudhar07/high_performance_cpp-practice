window.PAGE = {
 "num": 9,
 "title": "Atomics and Concurrency",
 "summary": "Starting and managing threads with std::thread (functions, lambdas, join/detach, jthread) in the class model of a market-data listener, a strategy and an order sender. Then why unsynchronized threads lose increments (data races are UB), and how std::mutex, lock_guard, unique_lock and scoped_lock fix it, plus condition variables for producer-consumer hand-off, spinlocks, and what each costs in latency.",
 "notes": [
  {
   "heading": "Why threads in a trading system",
   "body": "A trading process does several things at once with different latency needs. **In class** we split it into three threads inside **one process**:\n1. **Market-data listener**: reads packets from the exchange feed socket, decodes them into events (price, bid/ask) and hands them on.\n2. **Strategy**: consumes events, updates its view of the book, decides to trade.\n3. **Order sender**: sends orders/responses out through the order-entry socket (I/O bound).\n\nThreads are connected by queues (a producer-consumer pattern); the listener is the producer and the strategy the consumer.\n\n**Why threads and not three processes?**\n- Threads of one process **share the address space**: an event pushed into a queue is just a memory write, no copying through pipes/sockets and no syscalls (shared memory between processes is possible but more work).\n- Switching between threads of the same process does not change page tables (no TLB flush).\n- Cost: shared memory means **data races** are possible, and one crashing thread kills the whole process. Some firms do use separate processes plus shared-memory queues for isolation.\n\nRules of thumb: create threads **once at startup** (creation costs ~10–50 µs: kernel `clone`, stack mmap), **pin** each latency-critical thread to its own core, and never have more busy-spinning threads than cores (`std::thread::hardware_concurrency()` gives the logical core count, possibly 0 if unknown)."
  },
  {
   "heading": "Starting threads: std::thread with functions and lambdas",
   "body": "```cpp\n#include <thread>\nvoid listen(int port) { /* read market data */ }\n\nint main() {\n    std::thread md(listen, 9000);              // function + args\n    std::thread analytics([] {                 // lambda\n        /* compute signals */\n    });\n    md.join();                                 // wait for it to finish\n    analytics.join();\n}\n// build: g++ -O2 -std=c++20 -pthread main.cpp\n```\n- The thread starts running **immediately** at construction; the order in which threads run is up to the scheduler.\n- Arguments are **copied (or moved) into the new thread's storage**, even if the function takes a reference. To pass a real reference use `std::ref(x)` / `std::cref(x)`; a non-const `T&` parameter will not even compile without `std::ref`.\n- Member functions: `std::thread t(&Strategy::run, &strat, arg);` (pointer-to-member, then the object pointer).\n- `std::thread` is **move-only** (it owns an OS thread); store them in `std::vector<std::thread>` with `emplace_back`.\n- Exceptions escaping the thread function call `std::terminate`.\n\nEvery `std::thread` must be **joined or detached** before its destructor runs; destroying a *joinable* thread calls **`std::terminate()`**.\n- `join()`: block until it finishes. Can only be called once (`joinable()` becomes false).\n- `detach()`: let it run independently; you lose the handle and must make sure everything it touches outlives it.\n- C++20 **`std::jthread`** joins automatically in its destructor and supports cooperative cancellation through `std::stop_token` (`request_stop()`).\n\n```cpp\nstd::jthread worker([](std::stop_token st) {\n    while (!st.stop_requested()) poll_feed();\n});   // destructor: request_stop() then join()\n```"
  },
  {
   "heading": "Lifetimes and passing data to threads",
   "body": "The most common thread bug after races is a **dangling reference**:\n```cpp\nvoid start() {\n    int count = 0;\n    std::thread t([&] { ++count; });   // captures a local by reference\n    t.detach();                        // start() returns, count is destroyed\n}                                      // -> the thread writes a dead stack slot: UB\n```\nFixes: capture by value (`[count]`), join before the scope ends, or give the data a longer lifetime (heap/`shared_ptr`, a member of an object that outlives the thread).\n\n```cpp\nvoid fill(std::vector<int>& v);\nstd::vector<int> v;\nstd::thread t1(fill, v);            // does not compile: a copy cannot bind to vector&\nstd::thread t2(fill, std::ref(v));  // OK: passes a reference_wrapper\n```\n- Return values: a thread function's return value is discarded; communicate results via shared state (protected!), a `std::promise`/`std::future`, or `std::async`.\n- `thread_local` variables give each thread its own copy (per-thread counters, scratch buffers) with no synchronization needed."
  },
  {
   "heading": "Data races: why two threads lose increments",
   "body": "A **data race** = two threads access the same memory location concurrently, at least one access is a write, and they are not ordered by synchronization (mutex, atomics). In C++ a data race is **undefined behaviour**: not just \"a wrong number\".\n\n```cpp\nlong counter = 0;\nvoid work() { for (int i = 0; i < 1'000'000; ++i) ++counter; }\nint main() {\n    std::thread a(work), b(work);\n    a.join(); b.join();\n    std::cout << counter;   // expected 2000000, typically prints less (e.g. 1137452), varies per run\n}\n```\nWhy: `++counter` is three steps, **load → add → store**:\n```\nT1: load 41          T2: load 41\nT1: add -> 42        T2: add -> 42\nT1: store 42         T2: store 42     // two increments, counter grew by 1: a lost update\n```\nWith optimisation the compiler may even keep `counter` in a register and add 1,000,000 at once (legal, because it may assume no race), so the result can be anything; it is UB.\n\n`volatile long counter` does **not** fix this (it forces each load and store to happen but the three steps are still separate). **In class**, the first benchmark used a `volatile` counter only so the compiler would not delete the loop; that is a benchmarking trick, not synchronization.\n\nTwo fixes: protect it with a **mutex** (this session) or make it `std::atomic<long>` and use `fetch_add` (next session; a single `lock xadd` instruction, ~5–20 ns uncontended)."
  },
  {
   "heading": "std::mutex",
   "body": "A **mutex** (mutual exclusion) lets one thread at a time into a **critical section**.\n```cpp\nstd::mutex m;\nlong counter = 0;\nvoid work() {\n    for (int i = 0; i < 1'000'000; ++i) {\n        m.lock();\n        ++counter;          // only one thread at a time here\n        m.unlock();\n    }\n}   // now always prints 2000000\n```\n- `lock()` blocks until the mutex is free; `try_lock()` returns `false` instead of blocking; `unlock()` must be called by the owning thread.\n- Locking also gives **memory ordering**: everything written before `unlock()` is visible to the next thread after its `lock()` (unlock *synchronizes-with* the next lock). That is why plain variables guarded by a mutex are race-free.\n- Locking a `std::mutex` you already hold is UB (deadlock in practice); `std::recursive_mutex` allows it, but it is usually a design smell.\n- `std::timed_mutex` (`try_lock_for`), `std::shared_mutex` (C++17, many readers / one writer: `std::shared_lock` vs `std::unique_lock`).\n\nCost (Linux, glibc, built on a **futex**):\n| Situation | Approximate cost |\n|---|---|\n| Uncontended lock + unlock | ~15–25 ns (two atomic RMWs, no syscall) |\n| Contended: waiter must sleep | `futex` syscall + context switch, ~1–10 µs |\n| Lock held by a descheduled thread | unbounded wait |\n\nSo a mutex per increment (above) is correct but slow: 2 million lock/unlock pairs, with the mutex's cache line bouncing between cores. Better: lock less often (accumulate locally, lock once), or use an atomic. In HFT the hot path avoids mutexes because of the contended/descheduled tail latency."
  },
  {
   "heading": "RAII locks: lock_guard, unique_lock, scoped_lock",
   "body": "Calling `lock()`/`unlock()` by hand is fragile: an early `return` or an exception leaves the mutex locked forever. Use RAII wrappers that unlock in their destructor.\n\n```cpp\nvoid add(Book& b, Order o) {\n    std::lock_guard<std::mutex> lk(b.m);   // locks here (C++17: std::lock_guard lk(b.m);)\n    b.orders.push_back(o);                 // may throw: still unlocked by ~lock_guard\n}                                          // unlocks here\n```\n\n| Wrapper | Features | Use when |\n|---|---|---|\n| `std::lock_guard` | lock in ctor, unlock in dtor; nothing else; not movable | simple scoped critical section |\n| `std::unique_lock` | can `unlock()`/`lock()` again, `std::defer_lock`, `try_to_lock`, timeouts, movable; slightly bigger (stores an \"owns\" flag) | **required by `condition_variable::wait`**, or when you unlock early |\n| `std::scoped_lock` (C++17) | locks **several** mutexes at once with a deadlock-avoidance algorithm | operations touching two objects |\n| `std::shared_lock` | shared (reader) ownership of a `shared_mutex` | many readers |\n\n```cpp\nstd::unique_lock<std::mutex> lk(m);\nauto snapshot = data;   // copy under the lock\nlk.unlock();            // release early\nprocess(snapshot);      // slow work without holding the lock\n```\n\n### Deadlock\nThread 1 locks A then B; thread 2 locks B then A: each waits for the other forever. Prevention:\n- always lock in one **global order** (e.g. by address or by id);\n- lock both at once: `std::scoped_lock lk(a.m, b.m);` (or `std::lock(a.m, b.m)` + `adopt_lock`);\n- never call unknown code (callbacks) while holding a lock; keep critical sections short.\n\nCommon bug: `std::lock_guard<std::mutex>(m);` with no variable name creates a temporary that unlocks immediately (and in some forms declares a new variable `m`); always name the guard."
  },
  {
   "heading": "Condition variables",
   "body": "A **condition variable** lets a thread **sleep until another thread signals** that some condition (e.g. \"new market data available\") may now be true, instead of spinning on the CPU.\n\n```cpp\nstd::mutex m;\nstd::condition_variable cv;\nstd::queue<Tick> q;\nbool done = false;\n\nvoid producer() {                       // market-data thread\n    for (Tick t : feed()) {\n        { std::lock_guard lk(m); q.push(t); }   // 1. change state under the lock\n        cv.notify_one();                         // 2. wake one waiter\n    }\n    { std::lock_guard lk(m); done = true; }\n    cv.notify_all();\n}\n\nvoid consumer() {                       // strategy thread\n    for (;;) {\n        std::unique_lock lk(m);\n        cv.wait(lk, [] { return !q.empty() || done; });  // sleeps; re-checks predicate\n        if (q.empty()) return;          // done and drained\n        Tick t = q.front(); q.pop();\n        lk.unlock();                    // don't hold the lock while working\n        on_tick(t);\n    }\n}\n```\n\nHow `wait(lk, pred)` works: it is `while (!pred()) wait(lk);`. Each `wait` **atomically unlocks the mutex and sleeps**; on wake-up it **re-locks** before returning. Rules:\n- The waiter must use **`std::unique_lock`** (wait needs to unlock and relock it).\n- Always wait **with a predicate** (or a loop): **spurious wake-ups** are allowed, and another consumer may have taken the item first.\n- The shared state (`q`, `done`) must be modified **while holding the same mutex**, even if it is atomic; otherwise a **lost wake-up** can happen: the producer sets the flag and notifies between the consumer's check and its sleep, and the consumer sleeps forever.\n- `notify_one` wakes one waiter, `notify_all` wakes all (use it for shutdown). Notifying after unlocking avoids waking a thread that immediately blocks on the mutex.\n- `wait_for` / `wait_until` add timeouts.\n\nLatency: a wake-up costs a futex syscall plus scheduling, typically **5–50 µs** end-to-end. Fine for analytics and logging; too slow for tick-to-trade, where consumers **busy-spin** on a lock-free queue instead (next session)."
  },
  {
   "heading": "Producer-consumer queues with locks (the class assignment)",
   "body": "**In class (assignment):** write an SPSC (single-producer single-consumer) queue protected by **either a spinlock (a `while` loop) or `std::mutex`**, start a producer and a consumer thread (`t1.join(); t2.join();`), push and pop **64-byte objects**, and measure **how many you can push and pop per second**; submit as a Git PR with a README of your numbers.\n\nA bounded ring buffer with a mutex:\n```cpp\ntemplate <typename T, size_t N>\nclass LockedQueue {\n    std::array<T, N> buf_;\n    size_t head_ = 0, tail_ = 0;    // head_ = next pop, tail_ = next push\n    std::mutex m_;\npublic:\n    bool push(const T& v) {\n        std::lock_guard lk(m_);\n        if (tail_ - head_ == N) return false;   // full\n        buf_[tail_ % N] = v; ++tail_;\n        return true;\n    }\n    bool pop(T& out) {\n        std::lock_guard lk(m_);\n        if (tail_ == head_) return false;       // empty\n        out = buf_[head_ % N]; ++head_;\n        return true;\n    }\n};\nstruct alignas(64) Msg { char bytes[64]; };   // the 64-byte payload\n```\n**In class** we also sketched the naive version with a hand-made `LOCK = TRUE/FALSE` flag around `end++` and `start++`. With a plain `bool` that is itself a data race and two threads can both see \"unlocked\" and enter; the flag must be a `std::atomic_flag`/atomic with an atomic test-and-set (below), and the full/empty check plus the index update must be inside the same critical section.\n\nTypical results: a mutex queue does a few million ops/s (each op is ~2 atomics plus a cache-line transfer of the lock and indices; worse when threads sleep); a spinlock queue is often faster when both threads have their own core; the lock-free SPSC (session 10) does tens to hundreds of millions per second."
  },
  {
   "heading": "Spinlocks vs mutexes",
   "body": "A **spinlock** never sleeps; it loops until the lock is free.\n```cpp\nclass Spinlock {\n    std::atomic_flag f_ = ATOMIC_FLAG_INIT;     // C++20: default-initialised to clear\npublic:\n    void lock() {\n        while (f_.test_and_set(std::memory_order_acquire)) {   // atomic RMW\n            // C++20: while (f_.test(std::memory_order_relaxed)) _mm_pause();\n        }\n    }\n    void unlock() { f_.clear(std::memory_order_release); }\n};\n// usable with std::lock_guard<Spinlock> because it has lock()/unlock()\n```\n- `test_and_set` atomically sets the flag and returns the old value: only one thread can see `false`.\n- Spinning on a plain read (test-and-test-and-set) and executing `pause` (`_mm_pause()`) reduces cache-line traffic and power.\n\n| | Spinlock | std::mutex |\n|---|---|---|\n| Waiting | burns CPU | sleeps in the kernel (futex) |\n| Hand-off latency | ~50–100 ns (cache-line transfer) | µs when the waiter slept |\n| Good when | critical section tiny, threads pinned to own cores | longer sections, oversubscribed cores |\n| Danger | holder preempted → everyone spins for a whole time slice; priority inversion | context-switch latency |\n\n`std::atomic_flag` is the only type guaranteed lock-free by the standard."
  },
  {
   "heading": "Other synchronization tools",
   "body": "- **`std::atomic<T>`**: lock-free single-variable operations (`load`, `store`, `fetch_add`, `exchange`, `compare_exchange`); the subject of session 10.\n- **`std::call_once` / `std::once_flag`** and **function-local statics** (thread-safe initialisation since C++11, \"magic statics\").\n- **`std::future` / `std::promise` / `std::async`**: one-shot result passing. `std::async(std::launch::async, f)` runs `f` on a new thread; `fut.get()` blocks until the value (or exception) is ready. Internally a future is shared state protected by a mutex + condition variable (**in class:** \"how futures really work\").\n- **C++20**: `std::latch` (one-shot countdown), `std::barrier` (reusable phase sync), `std::counting_semaphore`, `std::atomic::wait/notify_one`.\n- **`thread_local`** storage for per-thread data with no sharing at all.\n\nDesign hierarchy for low latency: **no sharing** (each thread owns its state) > **single writer** + lock-free queue > atomics > short spinlock > mutex > mutex + condition variable."
  },
  {
   "heading": "Quick revision",
   "body": "- `std::thread t(f, args...)` starts immediately; args are copied; use `std::ref` for references.\n- Joinable thread destroyed → `std::terminate`; always `join()` or `detach()`; `std::jthread` auto-joins.\n- Detached thread + reference to a local = dangling = UB.\n- Data race (concurrent access, at least one write, no sync) = undefined behaviour.\n- `++x` is load-add-store: two threads lose updates; `volatile` does not help.\n- Mutex: one thread in the critical section; unlock→lock gives visibility of prior writes.\n- Uncontended mutex ~20 ns; contended → futex syscall + context switch (µs).\n- Prefer RAII: `lock_guard` (simple), `unique_lock` (flexible, needed for cv), `scoped_lock` (many mutexes, deadlock-free).\n- Deadlock: inconsistent lock order; fix with a global order or `scoped_lock`.\n- `cv.wait(lk, pred)` = `while(!pred()) wait(lk)`; unlocks while sleeping, relocks on wake.\n- Spurious wake-ups → always use a predicate; modify the predicate's state under the mutex → no lost wake-ups.\n- `notify_one` for one item, `notify_all` for shutdown/broadcast.\n- Spinlock = `atomic_flag::test_and_set` loop; great for tiny sections on dedicated cores.\n- Class model: market-data listener → strategy → sender threads, connected by producer-consumer queues.\n- Create and pin threads at startup; never block on the hot path."
  },
  {
   "heading": "Exam traps",
   "body": "- A data race is **UB**, not just \"a wrong count\"; the compiler may assume it does not happen.\n- `volatile` ≠ atomic ≠ thread-safe.\n- Forgetting `join()`/`detach()` does not leak the thread; it **terminates the program** at the `std::thread` destructor.\n- `std::thread t(f, v)` with `void f(std::vector<int>&)` does **not compile**; you need `std::ref(v)`.\n- `std::thread t(f());` passes the *result* of calling f (or is parsed as a function declaration); you mean `std::thread t(f);`.\n- `std::lock_guard<std::mutex>(m);` without a name does not protect anything.\n- `condition_variable::wait` requires `std::unique_lock`, not `lock_guard`.\n- Waiting without a predicate is a bug (spurious wake-ups, missed notifications).\n- Notifying before the waiter starts waiting is fine *only* if the state change was made under the mutex and the waiter checks the predicate first.\n- Setting the predicate flag without holding the mutex can cause a lost wake-up, even if the flag is atomic.\n- A plain `bool` \"lock\" flag is itself a data race; use `std::atomic_flag` with `test_and_set`.\n- Locking a non-recursive mutex twice in the same thread is UB (usually deadlock).\n- Holding a lock while doing I/O or calling callbacks turns a µs critical section into ms and invites deadlock.\n- More threads than cores with spinning = disaster (spinners steal time from the lock holder)."
  }
 ],
 "keyTerms": [
  {
   "term": "std::thread",
   "def": "Move-only RAII-less handle to an OS thread; starts running on construction and must be joined or detached."
  },
  {
   "term": "join()",
   "def": "Blocks the caller until the thread finishes; afterwards the thread is not joinable."
  },
  {
   "term": "detach()",
   "def": "Lets the thread run independently; the handle no longer refers to it and nothing waits for it."
  },
  {
   "term": "std::jthread",
   "def": "C++20 thread that requests stop and joins in its destructor; supports std::stop_token."
  },
  {
   "term": "std::ref",
   "def": "Wraps an object in std::reference_wrapper so std::thread/std::bind pass a reference instead of a copy."
  },
  {
   "term": "Data race",
   "def": "Unsynchronized concurrent accesses to one location with at least one write; undefined behaviour in C++."
  },
  {
   "term": "Lost update",
   "def": "Two read-modify-write sequences interleave so one write overwrites the other's result."
  },
  {
   "term": "Critical section",
   "def": "Code that accesses shared state and must be executed by only one thread at a time."
  },
  {
   "term": "std::mutex",
   "def": "Mutual-exclusion lock with lock/try_lock/unlock; on Linux built on a futex."
  },
  {
   "term": "futex",
   "def": "Linux fast user-space mutex: uncontended operations stay in user space; waiting threads sleep via a syscall."
  },
  {
   "term": "std::lock_guard",
   "def": "Minimal RAII lock: locks in the constructor, unlocks in the destructor."
  },
  {
   "term": "std::unique_lock",
   "def": "Flexible movable RAII lock supporting deferred locking, early unlock and use with condition variables."
  },
  {
   "term": "std::scoped_lock",
   "def": "C++17 RAII lock for one or more mutexes, locking several without deadlock."
  },
  {
   "term": "Deadlock",
   "def": "Threads wait on each other's locks forever, typically due to inconsistent lock ordering."
  },
  {
   "term": "Condition variable",
   "def": "Lets threads sleep until notified that shared state changed; used with a mutex and a predicate."
  },
  {
   "term": "Spurious wake-up",
   "def": "A wait returning without a notify; the reason wait must re-check a predicate."
  },
  {
   "term": "Lost wake-up",
   "def": "A notification arriving between a waiter's predicate check and its sleep, leaving it asleep forever."
  },
  {
   "term": "Producer-consumer",
   "def": "Pattern where one or more threads enqueue work/data and others dequeue and process it."
  },
  {
   "term": "Spinlock",
   "def": "Lock that busy-waits in a loop (e.g. atomic_flag::test_and_set) instead of sleeping."
  },
  {
   "term": "std::atomic_flag",
   "def": "Simplest atomic boolean with test_and_set/clear; the only type guaranteed always lock-free."
  },
  {
   "term": "thread_local",
   "def": "Storage duration giving each thread its own instance of a variable."
  },
  {
   "term": "std::future / std::promise",
   "def": "One-shot channel: the promise sets a value or exception, the future's get() waits for it."
  }
 ],
 "mcqs": [
  {
   "q": "What happens when this program runs?\n\n    #include <thread>\n    int main() {\n        std::thread t([] { /* work */ });\n    }",
   "options": [
    "std::terminate is called because t is still joinable when destroyed",
    "It runs the lambda and exits normally",
    "It fails to compile",
    "The lambda never runs"
   ],
   "answer": 0,
   "explanation": "A std::thread that is joinable at destruction calls std::terminate. You must call t.join() or t.detach() first (or use std::jthread).",
   "distractors": "It compiles fine, and the lambda may or may not have run before the abort.",
   "source": "lecture",
   "id": "L09-m1"
  },
  {
   "q": "Two threads each execute `for (int i = 0; i < 1'000'000; ++i) ++counter;` on a shared `long counter = 0;` with no synchronization. What does the C++ standard say about the result?",
   "options": [
    "It is always 2000000",
    "The program has a data race, so its behaviour is undefined",
    "It is always between 1000000 and 2000000",
    "It is always 1000000"
   ],
   "answer": 1,
   "explanation": "Unsynchronized concurrent writes are a data race, which is UB. In practice you usually see fewer than 2000000 because load-add-store sequences interleave and lose updates.",
   "distractors": "Numerical bounds like 1000000..2000000 describe typical observations, not a guarantee; with UB there is no guarantee.",
   "source": "lecture",
   "id": "L09-m2"
  },
  {
   "q": "Why does `++counter` lose updates when two threads run it concurrently?",
   "options": [
    "Because the CPU cache never writes values back to memory",
    "Because threads have separate copies of global variables",
    "Because ++ is compiled into separate load, add and store steps that can interleave",
    "Because ++ on long is not supported in threads"
   ],
   "answer": 2,
   "explanation": "Both threads can load the same old value, add one and store, so two increments produce +1.",
   "distractors": "Caches are coherent and globals are shared; the problem is the non-atomic read-modify-write.",
   "source": "lecture",
   "id": "L09-m3"
  },
  {
   "q": "Does this compile?\n\n    void fill(std::vector<int>& v) { v.push_back(1); }\n    std::vector<int> data;\n    std::thread t(fill, data);\n    t.join();",
   "options": [
    "Yes, and data has one element afterwards",
    "Yes, but data stays empty",
    "No: std::thread cannot take functions with parameters",
    "No: std::thread copies the argument, and the copy (an rvalue) cannot bind to a non-const lvalue reference"
   ],
   "answer": 3,
   "explanation": "std::thread decay-copies its arguments and passes them as rvalues; vector& cannot bind to an rvalue, so it fails to compile. std::ref(data) fixes it.",
   "distractors": "The 'stays empty' outcome is what would happen if f took the vector by value; functions with parameters are allowed.",
   "source": "lecture",
   "id": "L09-m4"
  },
  {
   "q": "What is wrong with this code?\n\n    void start() {\n        int n = 0;\n        std::thread t([&] { for (int i = 0; i < 100; ++i) ++n; });\n        t.detach();\n    }",
   "options": [
    "Nothing",
    "It deadlocks",
    "The thread may access n after start() returns and n is destroyed: a dangling reference (UB)",
    "detach() is not allowed on a lambda thread"
   ],
   "answer": 2,
   "explanation": "The lambda captures the local by reference, but the detached thread can outlive the stack frame. Capture by value or join before returning.",
   "distractors": "There is no lock to deadlock on, and detach works on any thread.",
   "source": "lecture",
   "id": "L09-m5"
  },
  {
   "q": "Which statement about `std::mutex` on Linux is true?",
   "options": [
    "An uncontended lock/unlock stays in user space (atomic operations); a syscall (futex) happens only when a thread must wait or be woken",
    "Every lock() makes a system call",
    "It busy-waits forever like a spinlock",
    "It can be copied to share it between threads"
   ],
   "answer": 0,
   "explanation": "glibc mutexes are futex-based: a fast path with atomic compare-exchange in user space and kernel help only under contention.",
   "distractors": "It does not always syscall, it sleeps rather than spins indefinitely, and mutexes are neither copyable nor movable.",
   "source": "lecture",
   "id": "L09-m6"
  },
  {
   "q": "Which lock type must be passed to `std::condition_variable::wait`?",
   "options": [
    "std::lock_guard<std::mutex>",
    "std::scoped_lock<std::mutex>",
    "A raw std::mutex",
    "std::unique_lock<std::mutex>"
   ],
   "answer": 3,
   "explanation": "wait has to unlock the mutex while sleeping and relock it afterwards, which only unique_lock supports (condition_variable_any accepts other lockables).",
   "distractors": "lock_guard and scoped_lock cannot be unlocked and relocked; wait takes a lock object, not a mutex.",
   "source": "lecture",
   "id": "L09-m7"
  },
  {
   "q": "Why should `cv.wait(lk)` always be used with a predicate (or inside a while loop)?",
   "options": [
    "Because wait without a predicate does not compile",
    "Because of spurious wake-ups, and because another thread may consume the item before this one runs",
    "Because the predicate makes wait faster",
    "Because notify_one always wakes every thread"
   ],
   "answer": 1,
   "explanation": "The standard allows wait to return without a notify, and the condition may no longer hold when the thread reacquires the lock; wait(lk, pred) re-checks in a loop.",
   "distractors": "The predicate-free overload compiles fine; notify_one wakes at most one thread.",
   "source": "lecture",
   "id": "L09-m8"
  },
  {
   "q": "Thread A: `ready = true; cv.notify_one();` (no lock held, `ready` is a std::atomic<bool>).\nThread B: `std::unique_lock lk(m); cv.wait(lk, []{ return ready.load(); });`\nWhat can go wrong?",
   "options": [
    "A lost wake-up: A can set ready and notify after B checked the predicate but before B went to sleep, so B sleeps forever",
    "Nothing: ready is atomic",
    "B wakes up twice",
    "It does not compile because ready is atomic"
   ],
   "answer": 0,
   "explanation": "The predicate check and going to sleep are atomic only with respect to the mutex. If A changes the state without the mutex, its notify can fall into that gap. Set ready under the lock.",
   "distractors": "Atomicity of the flag alone does not close the check-then-sleep window.",
   "source": "lecture",
   "id": "L09-m9"
  },
  {
   "q": "Thread 1 runs `lock(a); lock(b);` and thread 2 runs `lock(b); lock(a);`. What is the best fix?",
   "options": [
    "Use std::recursive_mutex",
    "Use std::scoped_lock lk(a, b); (or always lock in the same global order)",
    "Add sleep() between the two locks",
    "Unlock a before locking b in thread 1"
   ],
   "answer": 1,
   "explanation": "Inconsistent lock order causes deadlock. scoped_lock locks multiple mutexes with a deadlock-avoidance algorithm; a fixed global order also works.",
   "distractors": "recursive_mutex only helps re-locking the same mutex in one thread; sleeping changes timing, not correctness.",
   "source": "lecture",
   "id": "L09-m10"
  },
  {
   "q": "What is the bug here?\n\n    std::mutex m;\n    void add(int x) {\n        std::lock_guard<std::mutex>{m};\n        shared.push_back(x);\n    }",
   "options": [
    "lock_guard cannot be constructed with braces",
    "lock_guard locks twice",
    "The guard is an unnamed temporary destroyed at the end of the statement, so push_back runs unlocked",
    "Nothing; this is correct"
   ],
   "answer": 2,
   "explanation": "Without a variable name, the lock_guard lives only for that full-expression. Write `std::lock_guard<std::mutex> lk{m};`.",
   "distractors": "Braces are fine and lock_guard locks once; the problem is the object's lifetime.",
   "source": "lecture",
   "id": "L09-m11"
  },
  {
   "q": "What is the main advantage of `std::scoped_lock` over `std::lock_guard`?",
   "options": [
    "It is faster for a single mutex",
    "It works with condition variables",
    "It can be unlocked early",
    "It can lock several mutexes at once without risking deadlock"
   ],
   "answer": 3,
   "explanation": "scoped_lock is variadic and uses std::lock's deadlock-avoidance algorithm when given multiple mutexes.",
   "distractors": "It is not faster than lock_guard for one mutex, cannot be used with cv.wait, and cannot unlock early (unique_lock can).",
   "source": "lecture",
   "id": "L09-m12"
  },
  {
   "q": "A strategy thread must react to each market tick within a microsecond. Why is a mutex + condition variable queue a poor fit?",
   "options": [
    "Condition variables cannot carry data",
    "Mutexes do not work across threads",
    "A sleeping consumer is woken through a futex syscall and the scheduler, typically adding 5-50 µs and large jitter",
    "notify_one can only be called once"
   ],
   "answer": 2,
   "explanation": "Blocking hand-off involves kernel wake-up and a context switch; latency-critical consumers busy-spin on a lock-free queue on a pinned core instead.",
   "distractors": "The other claims are false; cv works fine, it is just slow to wake.",
   "source": "lecture",
   "id": "L09-m13"
  },
  {
   "q": "What does `test_and_set` on a `std::atomic_flag` do?",
   "options": [
    "Atomically sets the flag to true and returns its previous value",
    "Reads the flag without changing it",
    "Sets the flag only if it was true",
    "Clears the flag and returns true"
   ],
   "answer": 0,
   "explanation": "It is an atomic exchange with true, so exactly one thread sees false and acquires the spinlock.",
   "distractors": "Reading only is test() (C++20); clearing is clear().",
   "source": "lecture",
   "id": "L09-m14"
  },
  {
   "q": "In the class market-data example, why use three threads in one process rather than three processes?",
   "options": [
    "Processes cannot open sockets",
    "Threads cannot have data races",
    "Three processes cannot run on three cores",
    "Threads share one address space, so passing an event is a memory write into a queue with no IPC copies or syscalls, and thread switches do not change page tables"
   ],
   "answer": 3,
   "explanation": "Shared memory makes producer-consumer hand-off cheap; the price is that data races become possible and one crash kills everything.",
   "distractors": "Threads are exactly the case where races are possible; processes can use sockets and cores freely.",
   "source": "lecture",
   "id": "L09-m15"
  },
  {
   "q": "Which is the cheapest correct way to have two threads count events into one total that is read only after both join?",
   "options": [
    "Lock a mutex around every increment",
    "Each thread counts into its own local variable, then adds it to the total once under a mutex (or via one atomic add) at the end",
    "Use volatile long",
    "Use a condition variable for every increment"
   ],
   "answer": 1,
   "explanation": "Avoiding sharing removes both contention and cache-line ping-pong; only one synchronized operation per thread is needed.",
   "distractors": "A mutex per increment is correct but slow; volatile is incorrect; a cv is irrelevant.",
   "source": "lecture",
   "id": "L09-m16"
  },
  {
   "q": "What does `std::thread::hardware_concurrency()` return?",
   "options": [
    "A hint of the number of hardware threads (logical cores), or 0 if unknown",
    "The number of currently running threads",
    "The maximum number of std::thread objects allowed",
    "The number of physical CPU sockets"
   ],
   "answer": 0,
   "explanation": "It is a hint for sizing thread pools; with hyper-threading it counts logical CPUs.",
   "distractors": "It says nothing about running threads, object limits or sockets.",
   "source": "lecture",
   "id": "L09-m17"
  },
  {
   "q": "When is a spinlock preferable to a std::mutex?",
   "options": [
    "When the critical section performs disk I/O",
    "When critical sections are very short and each thread has its own dedicated core",
    "When there are many more threads than cores",
    "When a thread holds the lock for milliseconds"
   ],
   "answer": 1,
   "explanation": "Spinning avoids the µs sleep/wake cost when the wait will be only nanoseconds; with oversubscription or long holds it wastes CPU and can stall the holder.",
   "distractors": "Long or I/O-bound critical sections and oversubscribed systems are exactly where spinning hurts.",
   "source": "lecture",
   "id": "L09-m18"
  },
  {
   "q": "What does this print?\n\n    std::mutex m; int x = 0;\n    auto f = [&]{ for (int i = 0; i < 1000; ++i) { std::lock_guard lk(m); ++x; } };\n    std::thread a(f), b(f), c(f);\n    a.join(); b.join(); c.join();\n    std::cout << x;",
   "options": [
    "A value between 1000 and 3000",
    "1000",
    "3000",
    "Undefined: mutexes cannot be captured by reference"
   ],
   "answer": 2,
   "explanation": "Every increment happens inside the critical section, and join() makes the final value visible to main, so it always prints 3000.",
   "distractors": "Capturing the mutex by reference is the correct way to share it.",
   "source": "lecture",
   "id": "L09-m19"
  },
  {
   "q": "Which C++20 type automatically joins in its destructor?",
   "options": [
    "std::async",
    "std::thread",
    "std::future",
    "std::jthread"
   ],
   "answer": 3,
   "explanation": "std::jthread calls request_stop() and join() in its destructor.",
   "distractors": "std::thread terminates if joinable; a future from std::async may block in its destructor, but neither is a thread type that auto-joins.",
   "source": "lecture",
   "id": "L09-m20"
  },
  {
   "q": "What happens if you call `lock()` twice on the same std::mutex from the same thread?",
   "options": [
    "The second call returns immediately",
    "The mutex counts two locks and needs two unlocks",
    "Undefined behaviour; in practice the thread usually deadlocks itself",
    "A std::system_error is always thrown"
   ],
   "answer": 2,
   "explanation": "std::mutex is non-recursive; re-locking it is UB. Use std::recursive_mutex if you really need re-entrancy (usually a design issue).",
   "distractors": "Counting lock depth is recursive_mutex's behaviour; an exception may be thrown by some implementations but is not guaranteed.",
   "source": "lecture",
   "id": "L09-m21"
  },
  {
   "q": "Which is the idiomatic way to start a thread that runs member function `run(int)` of object `s`?",
   "options": [
    "std::thread t(&Strategy::run, &s, 5);",
    "std::thread t(s.run, 5);",
    "std::thread t(run, s, 5);",
    "std::thread t(&s.run(5));"
   ],
   "answer": 0,
   "explanation": "A pointer-to-member needs the object (pointer or std::ref) as the next argument.",
   "distractors": "s.run without a call is not a valid expression; the other forms call or name the function incorrectly.",
   "source": "lecture",
   "id": "L09-m22"
  }
 ],
 "msqs": [
  {
   "q": "Which of the following are data races (undefined behaviour)? (select all that apply)",
   "options": [
    "Two threads write a plain int with no synchronization",
    "One thread writes a plain bool flag while another reads it in a loop, unsynchronized",
    "Two threads only read a const global",
    "Two threads call fetch_add on the same std::atomic<int>",
    "Two threads write a vector only while holding the same mutex"
   ],
   "answers": [
    0,
    1
   ],
   "explanation": "A race needs concurrent unsynchronized accesses with at least one write: both plain int writes and the write/read on a plain bool qualify. Concurrent reads only, atomic operations and mutex-protected accesses are not races.",
   "id": "L09-x1"
  },
  {
   "q": "Which of the following correctly prevent lost increments of a shared counter? (select all that apply)",
   "options": [
    "Wrapping ++counter in std::lock_guard on a shared mutex",
    "Declaring the counter volatile",
    "Using std::atomic<long> with fetch_add",
    "Counting into thread-local variables and adding them after join()",
    "Adding std::this_thread::yield() after each increment"
   ],
   "answers": [
    0,
    2,
    3
   ],
   "explanation": "A mutex, an atomic RMW and thread-local accumulation all avoid unsynchronized read-modify-write. volatile does not make ++ atomic, and yield only changes timing.",
   "id": "L09-x2"
  },
  {
   "q": "Which statements about std::thread are true? (select all that apply)",
   "options": [
    "It starts running when constructed",
    "It is copyable",
    "Destroying it while joinable calls std::terminate",
    "Arguments are copied into the thread unless wrapped with std::ref",
    "join() can be called multiple times"
   ],
   "answers": [
    0,
    2,
    3
   ],
   "explanation": "Construction starts the thread, a joinable destructor terminates, and arguments are decay-copied. std::thread is move-only, and a second join throws because the thread is no longer joinable.",
   "id": "L09-x3"
  },
  {
   "q": "Which statements about std::unique_lock are true? (select all that apply)",
   "options": [
    "It can be unlocked and relocked before it goes out of scope",
    "It is required by std::condition_variable::wait",
    "It can lock several mutexes at once with deadlock avoidance",
    "It supports std::defer_lock and std::try_to_lock",
    "It is movable"
   ],
   "answers": [
    0,
    1,
    3,
    4
   ],
   "explanation": "unique_lock is the flexible RAII lock: early unlock, deferred/try locking, movable, and the lock type cv.wait needs. Locking several mutexes at once is scoped_lock's job (or std::lock).",
   "id": "L09-x4"
  },
  {
   "q": "Which are correct ways to avoid deadlock when two operations need mutexes A and B? (select all that apply)",
   "options": [
    "Always lock A before B in every thread",
    "Use std::scoped_lock lk(A, B);",
    "Use std::recursive_mutex for both",
    "Use std::lock(A, B) then adopt the locks with lock_guard(..., std::adopt_lock)",
    "Lock in whatever order is convenient in each function"
   ],
   "answers": [
    0,
    1,
    3
   ],
   "explanation": "A consistent global order, scoped_lock and std::lock all prevent the circular wait. recursive_mutex only allows re-locking by the same thread, and arbitrary order is exactly what causes deadlock.",
   "id": "L09-x5"
  },
  {
   "q": "Which statements about condition variables are true? (select all that apply)",
   "options": [
    "wait() atomically releases the mutex and blocks, and re-acquires it before returning",
    "Spurious wake-ups can happen",
    "notify_one() wakes all waiting threads",
    "The shared state the predicate reads should be modified while holding the mutex",
    "They are the lowest-latency way to hand ticks to a strategy thread"
   ],
   "answers": [
    0,
    1,
    3
   ],
   "explanation": "wait unlocks and sleeps atomically, may wake spuriously, and the state must change under the mutex to avoid lost wake-ups. notify_one wakes at most one thread, and the kernel wake-up path makes cvs too slow for tick-to-trade.",
   "id": "L09-x6"
  },
  {
   "q": "In the producer-consumer code `cv.wait(lk, [&]{ return !q.empty() || done; });`, which statements are true? (select all that apply)",
   "options": [
    "It is equivalent to while (!pred()) cv.wait(lk);",
    "If the predicate is already true, it returns without sleeping",
    "lk must be a std::lock_guard",
    "When it returns, the mutex is locked by this thread"
   ],
   "answers": [
    0,
    1,
    3
   ],
   "explanation": "The predicate overload loops, checks first (no sleep if already true) and returns holding the lock. lk must be a unique_lock, not a lock_guard.",
   "id": "L09-x7"
  },
  {
   "q": "Which statements about mutex costs on Linux are true? (select all that apply)",
   "options": [
    "An uncontended lock+unlock costs roughly tens of nanoseconds",
    "A contended mutex can put the waiter to sleep via the futex syscall",
    "A mutex never causes a context switch",
    "If the holder is descheduled, waiters can be delayed for a whole scheduler time slice or more"
   ],
   "answers": [
    0,
    1,
    3
   ],
   "explanation": "The fast path is a couple of atomic operations; contention leads to futex sleeping and wake-ups, and a preempted holder blocks everyone. Sleeping waiters do cause context switches.",
   "id": "L09-x8"
  },
  {
   "q": "Which of these compile and correctly pass `v` (a std::vector<int>) BY REFERENCE to `void f(std::vector<int>&)` on a new thread? (select all that apply)",
   "options": [
    "std::thread t(f, std::ref(v));",
    "std::thread t(f, v);",
    "std::thread t([&v]{ f(v); });",
    "std::thread t(f, &v);"
   ],
   "answers": [
    0,
    2
   ],
   "explanation": "std::ref wraps a reference, and a lambda capturing by reference calls f directly. Passing v copies it (and fails to bind to vector&), and &v is a pointer, which does not convert to a reference parameter.",
   "id": "L09-x9"
  },
  {
   "q": "Which are risks of a spinlock compared with std::mutex? (select all that apply)",
   "options": [
    "Waiting threads burn CPU",
    "If the holder is preempted, waiters spin uselessly for a long time",
    "Hand-off is always slower than a mutex",
    "With more spinning threads than cores, throughput can collapse"
   ],
   "answers": [
    0,
    1,
    3
   ],
   "explanation": "Spinning wastes cycles, suffers badly when the holder is descheduled, and oversubscription makes it worse. When each thread has a core, spinlock hand-off is usually faster than a sleeping mutex, so the third statement is false.",
   "id": "L09-x10"
  },
  {
   "q": "Which of the following are reasons the class design splits work into listener, strategy and sender threads? (select all that apply)",
   "options": [
    "The listener can keep reading the socket while the strategy computes",
    "Order sending is I/O bound and should not delay the strategy",
    "Threads remove the need for any synchronization",
    "Each stage can be pinned to its own core and kept cache-warm"
   ],
   "answers": [
    0,
    1,
    3
   ],
   "explanation": "Pipelining stages overlaps I/O and computation and lets each run on a dedicated warm core. The threads still need synchronization, typically producer-consumer queues.",
   "id": "L09-x11"
  },
  {
   "q": "Which statements about detach() are true? (select all that apply)",
   "options": [
    "After detach(), joinable() returns false",
    "The detached thread keeps running after the std::thread object is destroyed",
    "Detaching automatically extends the lifetime of locals the thread references",
    "If main returns while a detached thread is running, the process exits and the thread is killed"
   ],
   "answers": [
    0,
    1,
    3
   ],
   "explanation": "Detach releases the handle, the thread runs on, and returning from main ends the process (all threads). Nothing extends the lifetime of captured locals, which is the classic dangling-reference bug.",
   "id": "L09-x12"
  },
  {
   "q": "Which of the following synchronize memory so that writes made before by one thread become visible to another? (select all that apply)",
   "options": [
    "Unlocking a mutex in thread A, then locking the same mutex in thread B",
    "thread.join(): the joined thread's writes are visible after join returns",
    "Writing a volatile variable",
    "A release store to an atomic read by an acquire load that sees the value",
    "Calling std::this_thread::sleep_for"
   ],
   "answers": [
    0,
    1,
    3
   ],
   "explanation": "Mutex unlock/lock, join and release/acquire atomics create happens-before relations. volatile and sleeping provide no ordering guarantee.",
   "id": "L09-x13"
  }
 ],
 "short": [
  {
   "q": "Two threads each increment a shared `long counter` one million times without a lock. Explain why the final value is usually less than 2,000,000, show the interleaving, and give two correct fixes.",
   "checks": [
    {
     "label": "Load/read-modify-write separate steps",
     "patterns": [
      "load",
      "read[- ]modify[- ]write"
     ]
    },
    {
     "label": "Interleaving overwrites / lost update",
     "patterns": [
      "lost",
      "overwrit"
     ]
    },
    {
     "label": "Data race is UB",
     "patterns": [
      "undefined",
      "\\bUB\\b",
      "data race"
     ]
    },
    {
     "label": "Mutex fix",
     "patterns": [
      "mutex",
      "lock_guard"
     ]
    },
    {
     "label": "Atomic fix",
     "patterns": [
      "atomic",
      "fetch_add"
     ]
    }
   ],
   "modelAnswer": "++counter is not one operation: it compiles to load counter into a register, add 1, store it back (a read-modify-write). Two threads can interleave:\n\nT1: load 41    T2: load 41\nT1: add -> 42  T2: add -> 42\nT1: store 42   T2: store 42\n\nTwo increments happened but the counter grew by one: a lost update, because T2's store overwrites T1's. Repeated millions of times, many updates are lost and the total is below 2,000,000 and different each run. Formally this is a data race, which is undefined behaviour in C++ (the optimiser may even keep the value in a register).\n\nFix 1: a mutex: std::lock_guard<std::mutex> lk(m); ++counter; (correct, ~20 ns per uncontended lock, slower under contention).\nFix 2: std::atomic<long> counter; counter.fetch_add(1, std::memory_order_relaxed); (a single lock xadd instruction).\nBest for performance: count in a local variable per thread and add once at the end. volatile is not a fix.",
   "explanation": "Key: RMW in three steps, a concrete interleaving, data race = UB, and mutex/atomic fixes.",
   "id": "L09-s1"
  },
  {
   "q": "Write a producer-consumer pair using std::mutex and std::condition_variable where the consumer waits for new market data and the producer signals when data is available and when it is finished. Explain the rules you follow.",
   "checks": [
    {
     "label": "Uses condition_variable",
     "patterns": [
      "condition_variable"
     ]
    },
    {
     "label": "Waits with a predicate",
     "patterns": [
      "wait\\(\\s*\\w+\\s*,",
      "predicate"
     ]
    },
    {
     "label": "unique_lock in consumer",
     "patterns": [
      "unique_lock"
     ]
    },
    {
     "label": "notify_one / notify_all",
     "patterns": [
      "notify_(one|all)"
     ]
    },
    {
     "label": "Mentions spurious or lost wake-ups",
     "patterns": [
      "spurious",
      "lost wake"
     ]
    }
   ],
   "modelAnswer": "std::mutex m;\nstd::condition_variable cv;\nstd::queue<Tick> q;\nbool done = false;\n\nvoid producer() {\n    for (Tick t : feed()) {\n        { std::lock_guard<std::mutex> lk(m); q.push(t); }\n        cv.notify_one();\n    }\n    { std::lock_guard<std::mutex> lk(m); done = true; }\n    cv.notify_all();\n}\n\nvoid consumer() {\n    for (;;) {\n        std::unique_lock<std::mutex> lk(m);\n        cv.wait(lk, [] { return !q.empty() || done; });\n        if (q.empty()) return;            // done and drained\n        Tick t = q.front(); q.pop();\n        lk.unlock();                      // process without holding the lock\n        on_tick(t);\n    }\n}\n\nRules: (1) the consumer uses std::unique_lock because wait must unlock while sleeping and relock on wake-up; (2) always wait with a predicate, because of spurious wake-ups and because the item may already be consumed; (3) change the shared state (q, done) only while holding the mutex, otherwise a lost wake-up can happen between the predicate check and sleeping; (4) notify_one per item, notify_all for shutdown; (5) keep critical sections short.",
   "explanation": "The examiner wants the canonical cv pattern plus the reasons (unique_lock, predicate, state under lock).",
   "id": "L09-s2"
  },
  {
   "q": "Compare std::lock_guard, std::unique_lock and std::scoped_lock. When must you use unique_lock?",
   "checks": [
    {
     "label": "lock_guard simple RAII",
     "patterns": [
      "lock_guard"
     ]
    },
    {
     "label": "unique_lock flexible: unlock early / defer / movable",
     "patterns": [
      "defer",
      "unlock early",
      "movable",
      "relock"
     ]
    },
    {
     "label": "scoped_lock multiple mutexes / deadlock",
     "patterns": [
      "scoped_lock"
     ]
    },
    {
     "label": "condition variable needs unique_lock",
     "patterns": [
      "condition"
     ]
    }
   ],
   "modelAnswer": "All three are RAII wrappers that unlock in their destructor, so an exception or early return cannot leave a mutex locked.\n\n- std::lock_guard: locks in the constructor, unlocks in the destructor, nothing else; smallest and simplest; not movable.\n- std::unique_lock: flexible: you can unlock early and relock, construct with std::defer_lock or std::try_to_lock, use timed locking, and move it (return it from a function). It stores an \"owns the lock\" flag, so it is slightly heavier.\n- std::scoped_lock (C++17): like lock_guard but takes any number of mutexes and locks them all using a deadlock-avoidance algorithm (std::lock), e.g. std::scoped_lock lk(from.m, to.m); for a transfer between two accounts or books.\n\nYou must use unique_lock with std::condition_variable::wait, because wait has to release the mutex while sleeping and re-acquire it on wake-up; also when you need to unlock before the end of the scope.",
   "explanation": "Mention each wrapper's distinguishing feature and the condition-variable requirement.",
   "id": "L09-s3"
  },
  {
   "q": "Find all the bugs:\n\n    void worker(std::vector<int>& out) { out.push_back(42); }\n    void run() {\n        std::vector<int> results;\n        std::thread t(worker, results);\n        std::thread u([&] { results.push_back(7); });\n        u.detach();\n    }",
   "checks": [
    {
     "label": "std::ref needed / doesn't compile",
     "patterns": [
      "std::ref",
      "compile"
     ]
    },
    {
     "label": "t never joined -> terminate",
     "patterns": [
      "terminate"
     ]
    },
    {
     "label": "detached thread dangling reference",
     "patterns": [
      "dangl",
      "destroyed",
      "out ?live"
     ]
    },
    {
     "label": "Race on results between threads",
     "patterns": [
      "race",
      "mutex"
     ]
    }
   ],
   "modelAnswer": "1. std::thread t(worker, results); does not compile: std::thread copies results and passes the copy as an rvalue, which cannot bind to std::vector<int>&. Use std::thread t(worker, std::ref(results));.\n2. t is never joined or detached, so when run() returns its destructor calls std::terminate. Add t.join();.\n3. u is detached but captures results by reference; run() can return and destroy results while u still uses it: a dangling reference, undefined behaviour. Join u instead (or give the vector a lifetime that outlives the thread).\n4. Even after fixing 1-3, t and u both push_back into the same vector concurrently: a data race (vector is not thread-safe). Protect it with a std::mutex / lock_guard, or give each thread its own vector and merge after join.",
   "explanation": "Four separate issues: argument copying, join/terminate, lifetime, and a race.",
   "id": "L09-s4"
  },
  {
   "q": "Explain the class assignment: an SPSC queue with a spinlock or std::mutex, measuring how many 64-byte objects per second can be pushed and popped. What results would you expect, and why?",
   "checks": [
    {
     "label": "Two threads producer and consumer, join",
     "patterns": [
      "producer",
      "consumer"
     ]
    },
    {
     "label": "Spinlock with atomic_flag/test_and_set or mutex",
     "patterns": [
      "spinlock",
      "test_and_set",
      "atomic_flag"
     ]
    },
    {
     "label": "Measures ops per second with a clock",
     "patterns": [
      "per second",
      "chrono",
      "steady_clock",
      "ops/s"
     ]
    },
    {
     "label": "Cost reasons: cache line transfer / futex / sleeping",
     "patterns": [
      "cache[- ]line",
      "futex",
      "context switch",
      "sleep"
     ]
    }
   ],
   "modelAnswer": "Design: a fixed-size ring buffer (e.g. 1024 slots of struct alignas(64) Msg { char bytes[64]; }) with head and tail indices. Every push and pop takes the lock, checks full/empty, copies the 64-byte object, moves the index, unlocks. One producer thread pushes as fast as possible (retrying when full), one consumer pops (retrying when empty); main starts both, waits with t1.join(); t2.join(); and times the run with std::chrono::steady_clock, reporting messages per second = N / seconds.\n\nLock choices: std::mutex (futex-based: cheap when uncontended, but if a thread blocks it sleeps and needs a syscall and context switch to wake), or a spinlock built on std::atomic_flag::test_and_set in a while loop (never sleeps).\n\nExpected results: a few million ops per second with std::mutex; often more with a spinlock if both threads are pinned to their own cores, since the hand-off is just a cache-line transfer (~50-100 ns) of the lock and indices instead of a sleep. Throughput is capped because every operation bounces the lock's cache line between the two cores. The lock-free SPSC queue (next session) removes the lock entirely and reaches tens to hundreds of millions per second.",
   "explanation": "Describe the setup, the lock options, the measurement, and why the numbers come out as they do.",
   "id": "L09-s5"
  },
  {
   "q": "Why is a plain `bool locked` flag (set to true before the critical section, false after, with `while(locked){}` to wait) not a lock? Write a correct spinlock.",
   "checks": [
    {
     "label": "Check and set are separate / both see false",
     "patterns": [
      "both",
      "separate",
      "between"
     ]
    },
    {
     "label": "Plain bool is a data race / compiler may hoist",
     "patterns": [
      "data race",
      "hoist",
      "register",
      "undefined"
     ]
    },
    {
     "label": "Atomic test_and_set / exchange",
     "patterns": [
      "test_and_set",
      "exchange",
      "compare_exchange"
     ]
    },
    {
     "label": "Acquire/release ordering",
     "patterns": [
      "acquire",
      "release"
     ]
    }
   ],
   "modelAnswer": "Two problems. First, checking the flag and setting it are separate steps: both threads can read locked == false between the check and the set, and both enter the critical section. Second, a plain bool read and written by several threads is a data race (UB): the compiler may hoist the load out of while(locked){} into a register and spin forever, and there is no ordering guarantee for the data protected by the \"lock\".\n\nCorrect spinlock: the check-and-set must be one atomic read-modify-write, and the lock/unlock need acquire/release ordering:\n\nclass Spinlock {\n    std::atomic_flag f = ATOMIC_FLAG_INIT;\npublic:\n    void lock()   { while (f.test_and_set(std::memory_order_acquire)) { /* _mm_pause(); */ } }\n    void unlock() { f.clear(std::memory_order_release); }\n};\n\ntest_and_set atomically sets the flag and returns the old value, so exactly one thread sees false. Acquire on lock and release on unlock make the writes inside the critical section visible to the next owner.",
   "explanation": "Atomicity of check-and-set, the race on a plain bool, and acquire/release.",
   "id": "L09-s6"
  }
 ],
 "quiz": [],
 "coding": [
  {
   "id": "bounded-blocking-queue",
   "title": "Bounded Blocking Queue (Producer-Consumer)"
  }
 ],
 "prev": {
  "num": 8,
  "file": "lecture-08.html"
 },
 "next": {
  "num": 10,
  "file": "lecture-10.html"
 }
};
