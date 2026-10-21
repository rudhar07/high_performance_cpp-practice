window.PAGE = {
 "problems": [
  {
   "id": "memory-pool",
   "title": "Memory Pool",
   "origin": "course",
   "difficulty": "Medium",
   "topics": [
    "memory management",
    "free list",
    "alignment",
    "object lifetime",
    "placement new"
   ],
   "sessions": [
    3
   ],
   "statement": "### Problem Description\nImplement a fixed-size `MemoryPool<T, PoolSize>` that manages the memory for exactly `PoolSize` objects of type `T`, without calling `new` or `delete` for individual objects after construction.\n\nIn a low-latency system a general allocator is a liability: a call may take a lock, walk a free list of unknown length and touch memory that is not in cache, and the cost is not even the same twice. The usual answer is to take one block of memory up front and hand out slots from it.\n\nThe pool should:\n- allocate the backing memory once during construction\n- return raw memory suitable for constructing a `T` from `allocate()`\n- return the slot to the pool in `deallocate()`\n- reuse previously freed slots\n- correctly handle object lifetime\n- guarantee that returned memory is properly aligned for `T`\n- avoid calling `new`/`delete` for every object allocation\n\nThe key idea is a free list that lives inside the pool itself. A slot is either storage holding a live `T` or a free slot. A free slot has nothing to hold, so it can hold the address of the next free slot. `allocate()` takes the slot at the head of that list and `deallocate()` puts one back. Both are a couple of pointer writes, with no search and no system call. Pools like this sit under the order and message objects of most HFT systems.\n\n### Function Signature\n```cpp\ntemplate <typename T, std::size_t PoolSize>\nclass MemoryPool {\npublic:\n    MemoryPool();\n    ~MemoryPool();\n\n    T* allocate();\n    void deallocate(T* ptr);\n\n    MemoryPool(const MemoryPool&) = delete;\n    MemoryPool& operator=(const MemoryPool&) = delete;\n};\n```\n\n### Constraints\n- `PoolSize >= 1`, fixed at compile time\n- `allocate()` throws `std::bad_alloc` when all `PoolSize` slots are in use\n- the returned pointer is aligned for `T` and has room for one `T`\n- two in-use allocations never overlap\n- a slot given back by `deallocate()` is handed out again by a later `allocate()`\n- `allocate()` must not construct a `T`, and `deallocate()` must not destroy one (the caller uses placement new and `std::destroy_at`)\n- no `new`/`delete` per object, only the one block taken at construction\n\n### Example\n```cpp\nMemoryPool<int, 2> pool;\nint* p1 = pool.allocate();\nint* p2 = pool.allocate();\npool.deallocate(p1);\nint* p3 = pool.allocate();\n// p1 != p2, p3 == p1\n// a third allocate() while both slots are in use throws std::bad_alloc\n```\n",
   "signature": "#include <cstddef>\n#include <new>\n\ntemplate <typename T, std::size_t PoolSize>\nclass MemoryPool {\n    // TODO: storage for PoolSize slots, taken ONCE in the constructor.\n    //       Each slot must be big enough and aligned enough for a T *and* for a pointer to another free slot.\n    // TODO: where the chain of free slots starts.\n\npublic:\n    MemoryPool() {\n        // TODO: take the block, then link every slot into the free list\n    }\n\n    ~MemoryPool() {\n        // TODO: give the block back (do NOT destroy any T here)\n    }\n\n    T* allocate() {\n        // TODO: pop the free-list head; signal exhaustion with std::bad_alloc\n        return nullptr;\n    }\n\n    void deallocate(T* ptr) {\n        // TODO: push the slot back onto the free list (do NOT destroy *ptr here)\n        (void)ptr;\n    }\n\n    MemoryPool(const MemoryPool&) = delete;\n    MemoryPool& operator=(const MemoryPool&) = delete;\n};\n",
   "hints": [
    "A free slot holds no object, so its bytes can store a pointer to the next free slot. Keep one head pointer: allocate pops it, deallocate pushes onto it.",
    "Make the slot a union of a `next` pointer and `alignas(T) std::byte storage[sizeof(T)]`. The union is then big enough and aligned enough for both, even when sizeof(T) < sizeof(void*).",
    "Take the whole block once with `::operator new(sizeof(Slot) * PoolSize, std::align_val_t{alignof(Slot)})` and free it with the matching aligned `::operator delete`. Link the slots in the constructor, throw std::bad_alloc when head is null, and never call a constructor or destructor of T yourself."
   ],
   "checks": [
    {
     "label": "Keeps a free list through a next pointer stored in the free slots",
     "patterns": [
      "next"
     ]
    },
    {
     "label": "Has a free-list head that allocate() pops",
     "patterns": [
      "head",
      "free_?list",
      "first_?free"
     ]
    },
    {
     "label": "Slot is big enough for a pointer even when sizeof(T) is small (union or max of sizes)",
     "patterns": [
      "union",
      "std::max\\s*\\(\\s*sizeof",
      "sizeof\\s*\\(\\s*T\\s*\\)\\s*>\\s*sizeof",
      "sizeof\\s*\\(\\s*T\\s*\\)\\s*<\\s*sizeof"
     ]
    },
    {
     "label": "Guarantees alignment for T",
     "patterns": [
      "alignas",
      "align_val_t",
      "alignof"
     ]
    },
    {
     "label": "Takes one raw block up front (operator new, byte array or aligned_alloc)",
     "patterns": [
      "operator\\s+new",
      "std::byte",
      "unsigned\\s+char",
      "aligned_alloc"
     ]
    },
    {
     "label": "Throws std::bad_alloc when the pool is exhausted",
     "patterns": [
      "throw\\s+std::bad_alloc",
      "throw\\s+bad_alloc"
     ]
    },
    {
     "label": "Releases the block in the destructor",
     "patterns": [
      "operator\\s+delete",
      "\\bfree\\s*\\(",
      "delete\\s*\\[\\s*\\]"
     ]
    }
   ],
   "solution": "#include <cstddef>\n#include <new>\n#include <type_traits>\n\ntemplate <typename T, std::size_t PoolSize>\nclass MemoryPool {\n    static_assert(PoolSize >= 1, \"PoolSize must be at least 1\");\n    static_assert(!std::is_reference_v<T> && !std::is_void_v<T>, \"T must be an object type\");\n\n    // A slot is EITHER a free-list node OR raw storage for one T.\n    // The union is as large as the bigger of the two and as aligned as the stricter,\n    // so this also works when sizeof(T) < sizeof(void*) (e.g. MemoryPool<char, N>).\n    union Slot {\n        Slot* next;                               // active while the slot is free\n        alignas(T) std::byte storage[sizeof(T)];  // holds a T while the caller owns it\n    };\n\n    static constexpr std::align_val_t kAlign{alignof(Slot)};\n\n    Slot* block_;  // the one allocation, taken in the constructor\n    Slot* head_;   // head of the intrusive free list (nullptr = pool exhausted)\n\npublic:\n    MemoryPool()\n        : block_(static_cast<Slot*>(::operator new(sizeof(Slot) * PoolSize, kAlign))),\n          head_(nullptr) {\n        // Thread the free list back to front so slot 0 is handed out first.\n        // Placement new starts the lifetime of each Slot with `next` as the active member,\n        // and we only ever store pointers that placement new returned.\n        for (std::size_t i = PoolSize; i-- > 0;)\n            head_ = ::new (static_cast<void*>(block_ + i)) Slot{head_};\n    }\n\n    ~MemoryPool() {\n        // The pool releases memory only. Destroying live objects is the caller's job\n        // (allocate() did not construct them, so deallocate()/~MemoryPool() must not destroy them).\n        ::operator delete(static_cast<void*>(block_), kAlign);\n    }\n\n    MemoryPool(const MemoryPool&) = delete;\n    MemoryPool& operator=(const MemoryPool&) = delete;\n\n    // O(1): pop the head of the free list. No search, no system call, no constructor.\n    [[nodiscard]] T* allocate() {\n        if (head_ == nullptr) throw std::bad_alloc{};\n        Slot* slot = head_;\n        head_ = slot->next;                         // read the active member: well defined\n        return reinterpret_cast<T*>(slot->storage); // raw, suitably aligned storage for one T\n    }\n\n    // O(1): push the slot back. The caller must already have run std::destroy_at(ptr).\n    void deallocate(T* ptr) noexcept {\n        if (ptr == nullptr) return;\n        // Re-create a free-list node in the slot; this ends whatever lived there and makes\n        // `next` the active member again, so no type-punned write through a T* happens.\n        head_ = ::new (static_cast<void*>(ptr)) Slot{head_};\n    }\n\n    // Optional helper for debugging/tests: does ptr point into this pool's block?\n    bool owns(const T* ptr) const noexcept {\n        auto p = reinterpret_cast<const std::byte*>(ptr);\n        auto b = reinterpret_cast<const std::byte*>(block_);\n        return p >= b && p < b + sizeof(Slot) * PoolSize;\n    }\n};\n",
   "tests": "#include <cassert>\n#include <cstdint>\n#include <iostream>\n#include <memory>\n#include <set>\n#include <string>\n#include <vector>\n\nstruct alignas(64) CacheLineOrder {   // over-aligned type\n    std::uint64_t id;\n    double price;\n};\n\nstruct Tracked {\n    static inline int alive = 0;\n    std::string name;\n    explicit Tracked(std::string n) : name(std::move(n)) { ++alive; }\n    ~Tracked() { --alive; }\n};\n\nint main() {\n    // The example from the statement.\n    {\n        MemoryPool<int, 2> pool;\n        int* p1 = pool.allocate();\n        int* p2 = pool.allocate();\n        assert(p1 != p2);\n        pool.deallocate(p1);\n        int* p3 = pool.allocate();\n        assert(p3 == p1);\n        bool threw = false;\n        try { (void)pool.allocate(); } catch (const std::bad_alloc&) { threw = true; }\n        assert(threw);\n        pool.deallocate(p2);\n        pool.deallocate(p3);\n    }\n    // sizeof(T) < sizeof(void*): slots must still be big enough for the next pointer.\n    {\n        MemoryPool<char, 64> pool;\n        std::vector<char*> v;\n        for (int i = 0; i < 64; ++i) {\n            char* c = ::new (pool.allocate()) char(static_cast<char>('a' + i % 26));\n            v.push_back(c);\n        }\n        std::set<char*> distinct(v.begin(), v.end());\n        assert(distinct.size() == 64);\n        for (int i = 0; i < 64; ++i) assert(*v[i] == static_cast<char>('a' + i % 26));\n        for (char* c : v) pool.deallocate(c);\n    }\n    // Over-aligned type: every slot must honour alignof(T).\n    {\n        MemoryPool<CacheLineOrder, 8> pool;\n        CacheLineOrder* ps[8];\n        for (int i = 0; i < 8; ++i) {\n            void* raw = pool.allocate();\n            assert(reinterpret_cast<std::uintptr_t>(raw) % alignof(CacheLineOrder) == 0);\n            ps[i] = ::new (raw) CacheLineOrder{static_cast<std::uint64_t>(i), 100.0 + i};\n        }\n        for (int i = 0; i < 8; ++i) assert(ps[i]->id == static_cast<std::uint64_t>(i));\n        for (auto* p : ps) { std::destroy_at(p); pool.deallocate(p); }\n    }\n    // Lifetime: the pool never constructs or destroys; the caller does.\n    {\n        MemoryPool<Tracked, 4> pool;\n        Tracked* a = pool.allocate();\n        assert(Tracked::alive == 0);              // allocate() did not construct\n        a = std::construct_at(a, \"order-1\");\n        assert(Tracked::alive == 1 && a->name == \"order-1\");\n        std::destroy_at(a);\n        assert(Tracked::alive == 0);\n        pool.deallocate(a);\n        assert(Tracked::alive == 0);              // deallocate() did not destroy\n    }\n    // Reuse and no overlap under churn (LIFO reuse keeps hot slots in cache).\n    {\n        MemoryPool<std::uint64_t, 16> pool;\n        std::vector<std::uint64_t*> live;\n        for (int round = 0; round < 1000; ++round) {\n            while (live.size() < 16) {\n                auto* p = ::new (pool.allocate()) std::uint64_t(live.size());\n                assert(pool.owns(p));\n                live.push_back(p);\n            }\n            for (std::size_t i = 0; i < live.size(); ++i) assert(*live[i] == i); // no overlap\n            for (int k = 0; k < 7; ++k) { pool.deallocate(live.back()); live.pop_back(); }\n        }\n        for (auto* p : live) pool.deallocate(p);\n        pool.deallocate(nullptr); // harmless\n    }\n    // PoolSize == 1.\n    {\n        MemoryPool<double, 1> pool;\n        double* d = pool.allocate();\n        bool threw = false;\n        try { (void)pool.allocate(); } catch (const std::bad_alloc&) { threw = true; }\n        assert(threw);\n        pool.deallocate(d);\n        assert(pool.allocate() == d);\n    }\n    static_assert(!std::is_copy_constructible_v<MemoryPool<int, 4>>);\n    static_assert(!std::is_copy_assignable_v<MemoryPool<int, 4>>);\n    std::cout << \"ALL TESTS PASSED\\n\";\n}\n",
   "explanation": "### How it works\nEach slot is a `union Slot { Slot* next; alignas(T) std::byte storage[sizeof(T)]; }`. A free slot uses `next`; a slot owned by the caller uses `storage`. The union is automatically `max(sizeof(T), sizeof(void*))` bytes and `max(alignof(T), alignof(void*))` aligned, which is the standard fix for the case `sizeof(T) < sizeof(void*)` (a `MemoryPool<char, N>` with plain `sizeof(T)` slots would overwrite its neighbour when it stores the 8-byte `next` pointer).\n\nThe constructor takes **one** block with `::operator new(sizeof(Slot) * PoolSize, std::align_val_t{alignof(Slot)})`. The aligned overload matters for over-aligned types (for example an `alignas(64)` order struct), because plain `operator new` only promises `__STDCPP_DEFAULT_NEW_ALIGNMENT__` (usually 16). The destructor must use the matching aligned `::operator delete`. An in-object `alignas(Slot) std::byte buf[sizeof(Slot) * PoolSize]` array is also correct and avoids the heap entirely, but it makes the pool object huge (bad on the stack).\n\nThe free list is threaded through the slots: `head_ -> slot0 -> slot1 -> ... -> nullptr`.\n- `allocate()`: if `head_` is null, throw `std::bad_alloc`; otherwise take `head_`, move `head_` to `head_->next`, and return the slot's storage as a `T*`.\n- `deallocate(p)`: placement-new a fresh `Slot{head_}` at `p` and make it the new head.\n\nBoth are O(1) with a handful of instructions, no search, no lock and no system call. Reuse is LIFO, so the slot you get back is the one most recently freed, which is probably still in L1 cache.\n\n### Lifetime and the subtle UB points\n- **The pool hands out memory, not objects.** `allocate()` does not construct and `deallocate()` does not destroy. The caller writes `T* o = std::construct_at(p, args...)` (or `::new (p) T(args...)`) and later `std::destroy_at(o); pool.deallocate(o);`. Prefer using the pointer that placement new / `construct_at` returns: that pointer is guaranteed to point to the new object.\n- **Strict aliasing.** Writing `*reinterpret_cast<Slot**>(p) = head_` stores a `Slot*` through memory whose last object was a `T`. Re-creating the node with placement new (`::new (p) Slot{head_}`) instead *starts the lifetime* of a `Slot` there, so every later read of `next` reads a live object of the right type.\n- **`std::launder` is not a magic cast.** `std::launder(reinterpret_cast<T*>(p))` is only valid when a `T` object already lives at `p`. Calling it inside `allocate()` would be UB because no `T` exists yet. Use `launder` when you reuse a pointer to storage *after* constructing an object in it (as the in-place vector problem does).\n- **Alignment.** `alignas(T)` on the storage member (and the aligned `operator new`) is what makes `p % alignof(T) == 0` hold for every slot, since `sizeof(Slot)` is always a multiple of `alignof(Slot)`.\n- **The pool does not destroy live objects** in its destructor; it cannot know which slots are live. Debug builds often count outstanding allocations and assert the count is zero.\n- **Double free / foreign pointers** are not detected. A debug-only `owns(p)` range check plus a \"poison\" pattern catches most of them.\n\n### Complexity\n`allocate` and `deallocate` are O(1) worst case. Memory overhead is zero per object when `sizeof(T) >= sizeof(void*)`, plus one pointer for the head.\n\n### What an interviewer probes\n- Why does a general `malloc` hurt tail latency (locks, unpredictable free-list walks, page faults, `mmap`/`brk` system calls)?\n- What happens when `sizeof(T) < sizeof(void*)`? (Union / `std::max` slot size.)\n- How do you guarantee alignment for an `alignas(64)` type? (`alignas`, `std::align_val_t`.)\n- Who calls the constructor and the destructor? Why must `allocate()` not construct?\n- Is this thread-safe? (No. Options: one pool per thread, which is the usual HFT answer; a mutex; or a lock-free free list with an ABA guard, see the lock-free stack problem.)\n- Pre-faulting: touch every page in the constructor (or `mlock` it) so the first allocations on the hot path do not page-fault.\n",
   "followUps": [
    "Make it thread-safe without a mutex: turn the free list into a lock-free (Treiber) stack. Where does ABA bite, and how does a tagged head fix it?",
    "Make it grow: when the pool is exhausted, chain a second block instead of throwing. What does that do to worst-case latency?",
    "Write a `PoolAllocator<T>` that satisfies the standard Allocator requirements so `std::list<Order, PoolAllocator<Order>>` uses the pool.",
    "Add debug checks: detect double free, foreign pointers and objects still alive at pool destruction.",
    "Why might you pre-fault (touch) every page of the block in the constructor, and what does `mlock` add?",
    "Support several object sizes with size classes (a slab allocator). How do you find the right class in O(1)?"
   ]
  },
  {
   "id": "spsc-ring-buffer",
   "title": "SPSC Lock-Free Ring Buffer",
   "origin": "practice",
   "difficulty": "Medium",
   "topics": [
    "lock-free",
    "atomics",
    "memory ordering",
    "false sharing",
    "ring buffer"
   ],
   "sessions": [
    10,
    13
   ],
   "statement": "### Problem Description\nImplement a lock-free single-producer / single-consumer ring buffer `SpscQueue<T, Capacity>`. This is the queue that sits between the market-data thread and the strategy thread (and between the strategy and the order-sending thread) in almost every trading system. A mutex-protected queue costs a lock round trip, may put a thread to sleep and makes latency unpredictable. With exactly one writer and one reader, two atomic indices are enough: the producer is the only thread that writes `tail`, the consumer is the only thread that writes `head`, and acquire/release ordering on those indices publishes the element data safely.\n\nThe queue should:\n- store elements in a fixed ring of `Capacity` slots, allocated with the queue (no heap allocation after construction)\n- let the producer call `try_push()` and the consumer call `try_pop()` concurrently, with no locks\n- use `memory_order_release` when publishing an index and `memory_order_acquire` when reading the other side's index\n- keep the producer's and consumer's indices on different cache lines to avoid false sharing\n- preserve FIFO order\n\n### Function Signature\n```cpp\ntemplate <typename T, std::size_t Capacity>\nclass SpscQueue {\npublic:\n    template <typename U> bool try_push(U&& value);  // producer thread only\n    bool try_pop(T& out);                           // consumer thread only\n    std::size_t size() const;\n    bool empty() const;\n};\n```\n\n### Constraints\n- `Capacity` is a power of two and at least 2 (enforce with `static_assert`); map an index to a slot with `i & (Capacity - 1)`, not `%`\n- `try_push()` returns `false` when the queue is full and `try_pop()` returns `false` when it is empty; neither blocks, throws or allocates\n- all `Capacity` slots are usable (a full queue holds exactly `Capacity` elements)\n- both operations are O(1) and wait-free\n- exactly one producer thread and one consumer thread; no data races (clean under ThreadSanitizer)\n\n### Example\n```cpp\nSpscQueue<int, 4> q;\nq.try_push(1); q.try_push(2); q.try_push(3); q.try_push(4);\nbool ok = q.try_push(5);       // false: full\nint v;\nq.try_pop(v);                  // v == 1\nq.try_pop(v);                  // v == 2\n// output: ok = false, popped 1 then 2, size() == 2\n```\n",
   "signature": "#include <array>\n#include <atomic>\n#include <cstddef>\n\ntemplate <typename T, std::size_t Capacity>\nclass SpscQueue {\n    // TODO: reject capacities that are not a power of two at compile time\n    // TODO: producer-owned index and consumer-owned index, kept on separate cache lines\n    // TODO: the ring storage\n\npublic:\n    // Called only by the single producer thread. Returns false if the queue is full.\n    template <typename U>\n    bool try_push(U&& value) {\n        (void)value;\n        return false;\n    }\n\n    // Called only by the single consumer thread. Returns false if the queue is empty.\n    bool try_pop(T& out) {\n        (void)out;\n        return false;\n    }\n\n    std::size_t size() const { return 0; }\n    bool empty() const { return true; }\n};\n",
   "hints": [
    "Use two counters that only ever increase: tail (written only by the producer) and head (written only by the consumer). Size is tail - head; empty when equal, full when the difference equals Capacity.",
    "Publish with release and observe with acquire: the producer writes the slot and then does tail.store(t + 1, release); the consumer does tail.load(acquire) before reading the slot. Mirror this for head so the producer never overwrites a slot that is still being read.",
    "Put alignas(64) on each index so the two threads never write the same cache line, and static_assert that Capacity is a power of two so you can index with i & (Capacity - 1). Optional speed-up: cache the other side's index locally and only reload it when the queue looks full/empty."
   ],
   "checks": [
    {
     "label": "Uses std::atomic indices",
     "patterns": [
      "std::atomic\\s*<",
      "atomic\\s*<\\s*(std::)?size_t"
     ]
    },
    {
     "label": "Publishes with memory_order_release",
     "patterns": [
      "memory_order_release",
      "memory_order::release"
     ]
    },
    {
     "label": "Observes the other side with memory_order_acquire",
     "patterns": [
      "memory_order_acquire",
      "memory_order::acquire"
     ]
    },
    {
     "label": "Pads indices onto separate cache lines",
     "patterns": [
      "alignas\\s*\\(\\s*(64|128|kCacheLine|CACHE|hardware_destructive)",
      "hardware_destructive_interference_size",
      "char\\s+\\w*pad\\w*\\s*\\["
     ]
    },
    {
     "label": "Enforces a power-of-two capacity",
     "patterns": [
      "static_assert[^;]*(&|power)"
     ]
    },
    {
     "label": "Indexes the ring with a mask, not modulo",
     "patterns": [
      "&\\s*\\(?\\s*(kMask|mask|Capacity\\s*-\\s*1|MASK)"
     ]
    },
    {
     "label": "Distinguishes full from empty",
     "patterns": [
      "==\\s*Capacity",
      ">=\\s*Capacity",
      "full"
     ]
    }
   ],
   "solution": "#include <array>\n#include <atomic>\n#include <cstddef>\n#include <type_traits>\n#include <utility>\n\n// 64 bytes on x86-64. Apple M-series cores use 128-byte lines, so use 128 there if you can.\ninline constexpr std::size_t kCacheLine = 64;\n\ntemplate <typename T, std::size_t Capacity>\nclass SpscQueue {\n    static_assert(Capacity >= 2 && (Capacity & (Capacity - 1)) == 0,\n                  \"Capacity must be a power of two so that i & kMask == i % Capacity\");\n    static_assert(std::is_default_constructible_v<T> && std::is_move_assignable_v<T>);\n    static constexpr std::size_t kMask = Capacity - 1;\n\n    // Indices are monotonically increasing counters (they never wrap in practice with 64 bits).\n    // size = tail - head, full when size == Capacity, so every slot is usable.\n\n    // Producer's cache line: the index it writes plus its private copy of the consumer's index.\n    alignas(kCacheLine) std::atomic<std::size_t> tail_{0};\n    std::size_t cachedHead_{0};\n\n    // Consumer's cache line.\n    alignas(kCacheLine) std::atomic<std::size_t> head_{0};\n    std::size_t cachedTail_{0};\n\n    // The ring itself starts on its own line so it never shares one with the indices.\n    alignas(kCacheLine) std::array<T, Capacity> buf_{};\n\npublic:\n    SpscQueue() = default;\n    SpscQueue(const SpscQueue&) = delete;\n    SpscQueue& operator=(const SpscQueue&) = delete;\n\n    // Producer thread only.\n    template <typename U>\n    bool try_push(U&& value) noexcept(std::is_nothrow_assignable_v<T&, U&&>) {\n        const std::size_t t = tail_.load(std::memory_order_relaxed);   // my own index\n        if (t - cachedHead_ == Capacity) {                             // looks full: refresh\n            cachedHead_ = head_.load(std::memory_order_acquire);      // pairs with consumer's release\n            if (t - cachedHead_ == Capacity) return false;            // really full\n        }\n        buf_[t & kMask] = std::forward<U>(value);                      // plain write, slot is mine\n        tail_.store(t + 1, std::memory_order_release);                 // publish the element\n        return true;\n    }\n\n    // Consumer thread only.\n    bool try_pop(T& out) noexcept(std::is_nothrow_move_assignable_v<T>) {\n        const std::size_t h = head_.load(std::memory_order_relaxed);   // my own index\n        if (h == cachedTail_) {                                        // looks empty: refresh\n            cachedTail_ = tail_.load(std::memory_order_acquire);      // pairs with producer's release\n            if (h == cachedTail_) return false;                       // really empty\n        }\n        out = std::move(buf_[h & kMask]);\n        head_.store(h + 1, std::memory_order_release);                 // hand the slot back\n        return true;\n    }\n\n    // Approximate when called concurrently; exact when the queue is quiescent.\n    std::size_t size() const noexcept {\n        return tail_.load(std::memory_order_acquire) - head_.load(std::memory_order_acquire);\n    }\n    bool empty() const noexcept { return size() == 0; }\n    static constexpr std::size_t capacity() noexcept { return Capacity; }\n};\n",
   "tests": "#include <cassert>\n#include <cstdint>\n#include <cstddef>\n#include <iostream>\n#include <string>\n#include <thread>\n\nint main() {\n    // Single-threaded semantics.\n    {\n        SpscQueue<int, 4> q;\n        int v = -1;\n        assert(q.empty() && !q.try_pop(v));\n        for (int i = 0; i < 4; ++i) assert(q.try_push(i));\n        assert(!q.try_push(99));               // full: all Capacity slots usable\n        assert(q.size() == 4);\n        for (int i = 0; i < 4; ++i) { assert(q.try_pop(v)); assert(v == i); }  // FIFO\n        assert(!q.try_pop(v));\n        for (int round = 0; round < 100; ++round) {   // wrap-around many times\n            assert(q.try_push(round)); assert(q.try_push(round + 1));\n            assert(q.try_pop(v) && v == round); assert(q.try_pop(v) && v == round + 1);\n        }\n    }\n    // Move-only payloads and non-trivial types.\n    {\n        SpscQueue<std::string, 8> q;\n        std::string s = \"a long string that will not fit in the small buffer\";\n        assert(q.try_push(std::move(s)));\n        std::string out;\n        assert(q.try_pop(out) && out.size() > 20);\n    }\n    // Indices sit on different cache lines (no false sharing between producer and consumer).\n    static_assert(alignof(SpscQueue<int, 4>) >= kCacheLine);\n    static_assert(sizeof(SpscQueue<char, 2>) >= 3 * kCacheLine);\n    // Two threads: every value arrives exactly once, in order.\n    {\n        constexpr std::uint64_t N = 2'000'000;\n        static SpscQueue<std::uint64_t, 1024> q;   // static: big object, keep it off the stack\n        std::uint64_t sum = 0, expected = 0;\n        bool inOrder = true;\n        std::thread consumer([&] {\n            std::uint64_t v, next = 0;\n            while (next < N) {\n                if (q.try_pop(v)) { if (v != next) inOrder = false; sum += v; ++next; }\n            }\n        });\n        std::thread producer([&] {\n            for (std::uint64_t i = 0; i < N; ++i)\n                while (!q.try_push(i)) { /* spin: queue full */ }\n        });\n        producer.join();\n        consumer.join();\n        for (std::uint64_t i = 0; i < N; ++i) expected += i;\n        assert(inOrder);\n        assert(sum == expected);\n        assert(q.empty());\n    }\n    std::cout << \"ALL TESTS PASSED\\n\";\n}\n",
   "explanation": "### How it works\nTwo monotonically increasing counters: `tail_` (next slot the producer writes, owned by the producer) and `head_` (next slot the consumer reads, owned by the consumer). `tail - head` is the number of elements, so the queue is empty when they are equal and full when the difference is `Capacity`. Because the counters are never reduced modulo `Capacity`, there is no \"one slot wasted\" trick; the slot index is `counter & kMask`, which is one AND instead of a division (that is why the capacity must be a power of two).\n\n**Push (producer):** load its own `tail_` relaxed (only it writes it), check for space against the consumer's `head_`, write the element with a plain store, then `tail_.store(t + 1, release)`. The release store guarantees that the element write is visible to any thread that later reads this `tail_` value with acquire.\n\n**Pop (consumer):** load its own `head_` relaxed, read `tail_` with acquire (synchronises with the producer's release, so the element is fully written), move the element out, then `head_.store(h + 1, release)` so the producer knows the slot is free again (it reads `head_` with acquire before overwriting the slot).\n\n### Cache-line layout (the bug from class)\nIf `head_` and `tail_` are declared back to back they share one 64-byte line. Each push writes `tail_` and each pop writes `head_`, so the line bounces between the two cores on every operation (MESI ping-pong; `perf c2c` shows it as HITM traffic). `alignas(64)` on each index puts them on separate lines. The solution also keeps a **cached copy of the other side's index** (`cachedHead_` for the producer, `cachedTail_` for the consumer): a thread only reads the other thread's line when its cached copy says \"full\" or \"empty\", which removes most of the cross-core traffic. This is the design of well-known production SPSC queues.\n\nNote: Apple M-series and some other CPUs have 128-byte lines (and adjacent-line prefetch on Intel effectively pairs 64-byte lines), so 128 is a safer padding when you do not know the target. `std::hardware_destructive_interference_size` exists for this but is not available on every toolchain.\n\n### Complexity\nO(1), wait-free for both sides: no loops other than the caller's own retry, no CAS.\n\n### Pitfalls\n- Using `relaxed` for the publishing store: the consumer could see the new `tail` before the element bytes. On x86 this \"works by accident\" (TSO), on ARM it fails.\n- Using `seq_cst` everywhere: correct but adds a full fence (on x86 an `xchg`/`mfence` per push).\n- Calling `try_push` from two threads: SPSC means exactly one producer. Two producers race on `tail_`; you need an MPSC/MPMC design with CAS or per-slot sequence numbers.\n- `std::array<T, Capacity>` default-constructs every slot. For heavy `T` use raw aligned storage plus placement new and destroy on pop.\n- A full queue: the producer must decide whether to spin, drop, or apply back-pressure. Never block on the hot path.\n\n### What an interviewer probes\nWhy acquire/release and not relaxed; what false sharing is and how you would measure it; why a power-of-two capacity; what breaks with two producers; how you would make `try_pop` batch-friendly (read `tail` once, drain many).\n",
   "followUps": [
    "Make it multi-producer: why does a CAS on tail alone not work, and how do per-slot sequence numbers (Vyukov's bounded MPMC queue) fix it?",
    "Replace std::array<T, N> with raw aligned storage so T need not be default-constructible. Where do placement new and std::destroy_at go?",
    "Add a batch API (pop up to k elements with one acquire load). How much does it reduce cache-line traffic?",
    "How would you measure false sharing on Linux? (perf c2c, HITM counts.) What changes on a CPU with 128-byte lines?",
    "Why does the 64-bit counter never overflow in practice? What changes if you use 32-bit indices?"
   ]
  },
  {
   "id": "inplace-vector",
   "title": "Fixed-Capacity In-Place Vector",
   "origin": "practice",
   "difficulty": "Medium",
   "topics": [
    "placement new",
    "object lifetime",
    "alignment",
    "rule of five",
    "no heap"
   ],
   "sessions": [
    4,
    6
   ],
   "statement": "### Problem Description\nImplement `InplaceVector<T, N>`, a vector with a fixed capacity `N` whose elements live **inside the object itself** (on the stack, or inside another object) instead of on the heap. Hot-path code in a trading system often needs \"a small list\" (the fills produced by one incoming order, the levels touched by one market-data packet, the legs of a spread). `std::vector` would call the allocator on the first `push_back` and on every growth, which is exactly the unpredictable cost we want to avoid. A fixed-capacity in-place vector never allocates, its data is contiguous and cache-friendly, and its maximum size is known at compile time. (C++26 standardises this as `std::inplace_vector`.)\n\nThe vector should:\n- reserve uninitialised, correctly aligned storage for `N` elements inside the object\n- construct elements in place with placement new (`emplace_back`) and destroy them explicitly (`pop_back`, `clear`, destructor)\n- never default-construct the unused slots\n- follow the rule of five: copying makes a deep copy, moving moves the elements, and every constructed element is destroyed exactly once\n- support range-for iteration\n\n### Function Signature\n```cpp\ntemplate <typename T, std::size_t N>\nclass InplaceVector {\npublic:\n    template <typename... Args> T& emplace_back(Args&&... args);\n    void push_back(const T& v);\n    void push_back(T&& v);\n    void pop_back();\n    void clear();\n    T& operator[](std::size_t i);\n    std::size_t size() const;\n    bool empty() const;\n    static constexpr std::size_t capacity();\n    T* begin();\n    T* end();\n};\n```\n\n### Constraints\n- no heap allocation at all; `sizeof(InplaceVector<T, N>)` is about `N * sizeof(T)` plus a size field\n- `emplace_back` / `push_back` throw `std::bad_alloc` when `size() == N`, leaving the vector unchanged\n- if an element's constructor throws, `size()` must not change\n- every element is aligned for `T`, including over-aligned types such as `alignas(64)` structs\n- `push_back`, `pop_back` and `operator[]` are O(1); `clear` and the destructor are O(size)\n\n### Example\n```cpp\nInplaceVector<int, 3> v;\nv.push_back(1);\nv.emplace_back(2);\nv.push_back(3);\n// v.size() == 3, v[2] == 3\nv.push_back(4);   // throws std::bad_alloc, v still holds {1, 2, 3}\nv.pop_back();\n// v.size() == 2, v.back() == 2\n```\n",
   "signature": "#include <cstddef>\n#include <new>\n#include <utility>\n\ntemplate <typename T, std::size_t N>\nclass InplaceVector {\n    // TODO: raw storage for N elements INSIDE the object (no heap), correctly aligned for T\n    // TODO: current size\n\npublic:\n    InplaceVector() = default;\n    // TODO: copy/move constructors and assignments, destructor (rule of five)\n\n    template <typename... Args>\n    T& emplace_back(Args&&... args);      // construct in place; throw std::bad_alloc when full\n    void push_back(const T& v);\n    void push_back(T&& v);\n    void pop_back();                      // destroy the last element\n    void clear();\n\n    T& operator[](std::size_t i);\n    std::size_t size() const;\n    bool empty() const;\n    static constexpr std::size_t capacity() { return N; }\n    T* begin();\n    T* end();\n};\n",
   "hints": [
    "Store raw bytes, not T objects: alignas(T) std::byte storage_[sizeof(T) * N] plus a size_ counter. Live elements are always slots [0, size_).",
    "Construct with std::construct_at (or placement new) at storage_ + size_ * sizeof(T), and increment size_ only after the constructor returns. Destroy with std::destroy_at in pop_back, clear and the destructor.",
    "Write all five special members by hand: copy and move must construct elements one by one into the destination's storage. Access live elements through std::launder(reinterpret_cast<T*>(...))."
   ],
   "checks": [
    {
     "label": "Raw, aligned storage inside the object",
     "patterns": [
      "alignas\\s*\\(\\s*T\\s*\\)",
      "aligned_storage",
      "alignof\\s*\\(\\s*T\\s*\\)"
     ]
    },
    {
     "label": "Byte array or union storage (elements are not default-constructed)",
     "patterns": [
      "std::byte",
      "unsigned\\s+char",
      "union"
     ]
    },
    {
     "label": "Constructs in place with placement new or construct_at",
     "patterns": [
      "construct_at",
      "new\\s*\\(\\s*[^)]*\\)\\s*T\\b",
      "::new"
     ]
    },
    {
     "label": "Destroys explicitly with destroy_at or ~T()",
     "patterns": [
      "destroy_at",
      "~T\\s*\\(",
      "std::destroy"
     ]
    },
    {
     "label": "Throws when full",
     "patterns": [
      "throw"
     ]
    },
    {
     "label": "Forwards constructor arguments",
     "patterns": [
      "std::forward"
     ]
    },
    {
     "label": "Implements copy and move operations (rule of five)",
     "patterns": [
      "InplaceVector\\s*&&|\\w+\\s*\\(\\s*\\w+\\s*&&\\s*\\w+\\s*\\)\\s*noexcept"
     ]
    }
   ],
   "solution": "#include <cstddef>\n#include <memory>\n#include <new>\n#include <type_traits>\n#include <utility>\n\ntemplate <typename T, std::size_t N>\nclass InplaceVector {\n    static_assert(N >= 1, \"capacity must be at least 1\");\n\n    alignas(T) std::byte storage_[sizeof(T) * N];  // raw, uninitialised, inside the object\n    std::size_t size_ = 0;\n\n    // Address of slot i as raw memory (no object needs to live there yet).\n    void* raw(std::size_t i) noexcept { return storage_ + i * sizeof(T); }\n    // Pointer to the live element i. std::launder is required: storage_ is a byte array,\n    // and we are reaching an object that placement new created inside it.\n    T* ptr(std::size_t i) noexcept { return std::launder(reinterpret_cast<T*>(storage_ + i * sizeof(T))); }\n    const T* ptr(std::size_t i) const noexcept {\n        return std::launder(reinterpret_cast<const T*>(storage_ + i * sizeof(T)));\n    }\n\npublic:\n    using value_type = T;\n    using iterator = T*;\n    using const_iterator = const T*;\n\n    InplaceVector() noexcept = default;\n\n    // Rule of five: the compiler-generated versions would copy raw bytes, which is wrong for\n    // any non-trivial T (two vectors would \"own\" the same std::string buffer).\n    InplaceVector(const InplaceVector& other) {\n        for (const T& x : other) push_back(x);       // if a copy throws, ~InplaceVector cleans up\n    }\n    InplaceVector(InplaceVector&& other) noexcept(std::is_nothrow_move_constructible_v<T>) {\n        for (T& x : other) push_back(std::move(x));\n        other.clear();\n    }\n    InplaceVector& operator=(const InplaceVector& other) {\n        if (this != &other) { clear(); for (const T& x : other) push_back(x); }\n        return *this;\n    }\n    InplaceVector& operator=(InplaceVector&& other) noexcept(std::is_nothrow_move_constructible_v<T>) {\n        if (this != &other) { clear(); for (T& x : other) push_back(std::move(x)); other.clear(); }\n        return *this;\n    }\n    ~InplaceVector() { clear(); }\n\n    template <typename... Args>\n    T& emplace_back(Args&&... args) {\n        if (size_ == N) throw std::bad_alloc{};                       // full: no heap fallback\n        T* p = std::construct_at(static_cast<T*>(raw(size_)), std::forward<Args>(args)...);\n        ++size_;                                                       // only after construction succeeded\n        return *p;\n    }\n    void push_back(const T& v) { emplace_back(v); }\n    void push_back(T&& v) { emplace_back(std::move(v)); }\n\n    // Hot-path friendly variant: no exception, nullptr when full.\n    template <typename... Args>\n    T* try_emplace_back(Args&&... args) {\n        if (size_ == N) return nullptr;\n        return &emplace_back(std::forward<Args>(args)...);\n    }\n\n    void pop_back() noexcept {          // precondition: !empty()\n        --size_;\n        std::destroy_at(ptr(size_));\n    }\n    void clear() noexcept {\n        while (size_ > 0) pop_back();   // destroy in reverse order of construction\n    }\n\n    T& operator[](std::size_t i) noexcept { return *ptr(i); }\n    const T& operator[](std::size_t i) const noexcept { return *ptr(i); }\n    T& back() noexcept { return *ptr(size_ - 1); }\n\n    T* begin() noexcept { return size_ ? ptr(0) : static_cast<T*>(raw(0)); }\n    T* end() noexcept { return begin() + size_; }\n    const T* begin() const noexcept { return size_ ? ptr(0) : reinterpret_cast<const T*>(storage_); }\n    const T* end() const noexcept { return begin() + size_; }\n\n    std::size_t size() const noexcept { return size_; }\n    bool empty() const noexcept { return size_ == 0; }\n    bool full() const noexcept { return size_ == N; }\n    static constexpr std::size_t capacity() noexcept { return N; }\n};\n",
   "tests": "#include <cassert>\n#include <cstdint>\n#include <iostream>\n#include <string>\n\nstruct Counted {\n    static inline int alive = 0, copies = 0, moves = 0;\n    int v;\n    explicit Counted(int x) : v(x) { ++alive; }\n    Counted(const Counted& o) : v(o.v) { ++alive; ++copies; }\n    Counted(Counted&& o) noexcept : v(o.v) { ++alive; ++moves; }\n    ~Counted() { --alive; }\n};\nstruct alignas(64) Wide { std::uint64_t a; };\nstruct ThrowOnThird {\n    static inline int built = 0;\n    explicit ThrowOnThird(int) { if (++built == 3) throw 42; }\n};\n\nint main() {\n    {   // basic API\n        InplaceVector<int, 3> v;\n        assert(v.empty() && v.capacity() == 3);\n        v.push_back(1); v.emplace_back(2); v.push_back(3);\n        assert(v.size() == 3 && v.full() && v[0] == 1 && v[2] == 3 && v.back() == 3);\n        bool threw = false;\n        try { v.push_back(4); } catch (const std::bad_alloc&) { threw = true; }\n        assert(threw && v.size() == 3);\n        assert(v.try_emplace_back(9) == nullptr);\n        v.pop_back();\n        assert(v.size() == 2 && v.back() == 2);\n        int sum = 0; for (int x : v) sum += x;\n        assert(sum == 3);\n    }\n    {   // lifetimes: every constructed element is destroyed exactly once\n        {\n            InplaceVector<Counted, 8> v;\n            for (int i = 0; i < 5; ++i) v.emplace_back(i);\n            assert(Counted::alive == 5);\n            v.pop_back();\n            assert(Counted::alive == 4);\n            InplaceVector<Counted, 8> copy = v;        // deep copy\n            assert(Counted::alive == 8 && copy.size() == 4 && copy[3].v == 3);\n            InplaceVector<Counted, 8> moved = std::move(copy);\n            assert(moved.size() == 4 && copy.empty() && Counted::alive == 8);\n            copy = moved;                              // copy-assign\n            moved = std::move(copy);                   // move-assign\n            assert(moved.size() == 4 && copy.empty() && Counted::alive == 8);\n        }\n        assert(Counted::alive == 0);\n    }\n    {   // non-trivial T (heap-owning string): ASan catches double free / leaks here\n        InplaceVector<std::string, 4> v;\n        v.push_back(std::string(100, 'x'));\n        v.emplace_back(\"short\");\n        InplaceVector<std::string, 4> w = v;\n        w[0][0] = 'y';\n        assert(v[0][0] == 'x');                        // really a deep copy\n        v = std::move(w);\n        assert(v[0][0] == 'y' && v.size() == 2);\n    }\n    {   // over-aligned T\n        InplaceVector<Wide, 4> v;\n        for (int i = 0; i < 4; ++i) {\n            Wide& w = v.emplace_back(Wide{static_cast<std::uint64_t>(i)});\n            assert(reinterpret_cast<std::uintptr_t>(&w) % 64 == 0);\n        }\n    }\n    {   // a throwing constructor leaves the vector consistent\n        InplaceVector<ThrowOnThird, 4> v;\n        v.emplace_back(0); v.emplace_back(0);\n        bool threw = false;\n        try { v.emplace_back(0); } catch (int) { threw = true; }\n        assert(threw && v.size() == 2);\n    }\n    static_assert(sizeof(InplaceVector<std::uint32_t, 16>) <= 16 * 4 + sizeof(std::size_t));\n    std::cout << \"ALL TESTS PASSED\\n\";\n}\n",
   "explanation": "### How it works\n`alignas(T) std::byte storage_[sizeof(T) * N]` is raw memory: no `T` is constructed until you ask for one. `size_` counts the live elements, which always occupy slots `[0, size_)`.\n- `emplace_back(args...)`: check capacity, then `std::construct_at(slot, args...)` (placement new) and **only then** increment `size_`. If the constructor throws, `size_` is unchanged and nothing needs to be cleaned up.\n- `pop_back()`: decrement `size_`, then `std::destroy_at` the element. Destroying is explicit because the compiler cannot know which slots hold live objects.\n- `clear()` and the destructor destroy the live elements in reverse order.\n\n### Why `std::launder`\n`reinterpret_cast<T*>(storage_ + i * sizeof(T))` gives a pointer whose value is \"a byte inside `storage_`\". After placement new there *is* a `T` at that address, but the pointer was not obtained from the placement new expression. `std::launder` tells the compiler \"there is a live `T` here, give me a pointer to it\", which makes the access well defined (and stops the optimiser from assuming the storage still holds the bytes it saw before). Never launder a slot that has no live object: that is UB.\n\n### Rule of five\nThe implicit copy constructor would `memcpy`-style copy `storage_`, so two vectors would think they own the same `std::string` heap buffers: double free on destruction (ASan reports it). The solution copy-constructs each element into the new storage, move-constructs for moves, and leaves the source empty after a move. Copy assignment clears then copies (strong guarantee would need copy-and-swap). Because the storage is inside the object, **a move is O(n)**, not O(1) like `std::vector`. That is the price of never allocating.\n\n### Complexity\n`push_back`/`emplace_back`/`pop_back`/`operator[]` O(1); copy, move and `clear` O(size). No heap traffic at all.\n\n### Pitfalls the interviewer looks for\n- Using `T data_[N]` instead of raw bytes: it default-constructs `N` objects (fails for types without a default constructor and wastes time).\n- Forgetting `alignas(T)`: a `std::byte` array is only 1-aligned, so an `alignas(64)` element would be misaligned (UB, and slow or a crash on some ISAs).\n- Incrementing `size_` before construction: an exception leaves a \"live\" slot with no object, and the destructor later destroys garbage.\n- `pop_back` on an empty vector, or indexing out of range: preconditions; add `assert` in debug builds.\n- Forgetting `const` overloads and iterator invalidation rules (here, pointers stay valid until the element is popped; there is no reallocation).\n",
   "followUps": [
    "Give move assignment the strong exception guarantee. Is that worth it on the hot path?",
    "For trivially copyable T, make copy a single memcpy (if constexpr std::is_trivially_copyable_v<T>). Can the whole class be trivially copyable for such T?",
    "Add insert/erase in the middle. What happens to element lifetimes when you shift?",
    "Build a SmallVector<T, N> that starts in place and spills to the heap past N. What is the extra cost per access?",
    "Why is moving an InplaceVector O(n) while moving a std::vector is O(1)?"
   ]
  },
  {
   "id": "unique-ptr",
   "title": "UniquePtr with a Custom Deleter",
   "origin": "practice",
   "difficulty": "Easy",
   "topics": [
    "smart pointers",
    "RAII",
    "move semantics",
    "rule of five"
   ],
   "sessions": [
    2,
    7
   ],
   "statement": "### Problem Description\nImplement a minimal `UniquePtr<T, Deleter>`: a move-only smart pointer that is the single owner of one object and destroys it with a customisable deleter when the owner goes away. In a low-latency system raw `new`/`delete` pairs are a source of leaks and double frees, but a shared, reference-counted pointer adds an atomic increment on every copy. `unique_ptr` gives RAII ownership with **zero overhead**: with an empty deleter it is exactly one pointer wide and compiles down to the same code as a raw pointer. Custom deleters let the same type return objects to a memory pool or close a file/socket handle.\n\nThe smart pointer should:\n- own at most one object and release it in its destructor using the deleter\n- be move-only: copying is a compile error, moving transfers ownership and leaves the source empty\n- support `release()`, `reset()`, `swap()`, `get()`, `get_deleter()`, `operator*`, `operator->` and `explicit operator bool`\n- accept stateless deleters (function objects), stateful deleters (lambdas with captures) and function pointers (for example `&std::fclose`)\n- provide a `MakeUnique<T>(args...)` factory\n\n### Function Signature\n```cpp\ntemplate <typename T, typename Deleter = DefaultDelete<T>>\nclass UniquePtr {\npublic:\n    UniquePtr();\n    explicit UniquePtr(T* p);\n    UniquePtr(T* p, Deleter d);\n    UniquePtr(UniquePtr&& other) noexcept;\n    UniquePtr& operator=(UniquePtr&& other) noexcept;\n    ~UniquePtr();\n    T* release();\n    void reset(T* p = nullptr);\n    void swap(UniquePtr& other);\n    T* get() const;\n    explicit operator bool() const;\n    T& operator*() const;\n    T* operator->() const;\n};\ntemplate <typename T, typename... Args> UniquePtr<T> MakeUnique(Args&&... args);\n```\n\n### Constraints\n- copy constructor and copy assignment are deleted; move operations are `noexcept`\n- `sizeof(UniquePtr<T>) == sizeof(T*)` when the deleter is empty\n- move assignment and `reset()` destroy the previously owned object exactly once; self-move-assignment is safe\n- `release()` must not call the deleter\n- every operation is O(1) and none of them allocates (only `MakeUnique` calls `new`)\n\n### Example\n```cpp\nauto a = MakeUnique<Order>(1, 100.5);\nUniquePtr<Order> b = std::move(a);   // a is now empty\n// UniquePtr<Order> c = b;           // does not compile: copy is deleted\nb.reset(new Order(2, 99.0));         // Order 1 destroyed here\nOrder* raw = b.release();            // b empty, Order 2 still alive\ndelete raw;\n// output: a == nullptr, b == nullptr, Order::alive == 0\n```\n",
   "signature": "#include <cstddef>\n#include <utility>\n\ntemplate <typename T>\nstruct DefaultDelete {\n    void operator()(T* p) const { delete p; }\n};\n\ntemplate <typename T, typename Deleter = DefaultDelete<T>>\nclass UniquePtr {\n    // TODO: the owned pointer and the deleter\n\npublic:\n    UniquePtr() = default;\n    explicit UniquePtr(T* p);\n    UniquePtr(T* p, Deleter d);\n\n    // TODO: copy must be impossible; move must transfer ownership\n    // TODO: destructor\n\n    T* release();                 // give up ownership, return the pointer\n    void reset(T* p = nullptr);   // delete the current object, take p\n    void swap(UniquePtr& other);\n\n    T* get() const;\n    Deleter& get_deleter();\n    explicit operator bool() const;\n    T& operator*() const;\n    T* operator->() const;\n};\n\ntemplate <typename T, typename... Args>\nUniquePtr<T> MakeUnique(Args&&... args);\n",
   "hints": [
    "The whole class is one invariant: a non-null pointer means this object must call the deleter exactly once. Delete the copy constructor and copy assignment.",
    "Move constructor: take other's pointer and set other's to nullptr (std::exchange does both). Move assignment: reset(other.release()).",
    "reset(p): remember the old pointer, store p, then call the deleter on the old one. Mark [[no_unique_address]] on the deleter member so an empty deleter takes no space."
   ],
   "checks": [
    {
     "label": "Copy constructor / copy assignment deleted",
     "patterns": [
      "const\\s+UniquePtr\\s*&\\s*\\)\\s*=\\s*delete",
      "const\\s+\\w+\\s*&\\s*\\w*\\s*\\)\\s*=\\s*delete"
     ]
    },
    {
     "label": "Move constructor takes an rvalue reference",
     "patterns": [
      "UniquePtr\\s*&&"
     ]
    },
    {
     "label": "Moved-from object is nulled",
     "patterns": [
      "exchange",
      "=\\s*nullptr",
      "release\\s*\\(\\s*\\)"
     ]
    },
    {
     "label": "Destructor calls the deleter",
     "patterns": [
      "~UniquePtr\\s*\\([^)]*\\)[^{]*\\{[^}]*(del|reset)"
     ]
    },
    {
     "label": "Has release() that gives up ownership without deleting",
     "patterns": [
      "release\\s*\\(\\s*\\)\\s*(const\\s*)?(noexcept\\s*)?\\{"
     ]
    },
    {
     "label": "Has reset() that replaces the owned object",
     "patterns": [
      "reset\\s*\\([^)]*\\)\\s*(noexcept\\s*)?\\{"
     ]
    },
    {
     "label": "Move operations are noexcept",
     "patterns": [
      "&&\\s*\\w*\\s*\\)\\s*noexcept"
     ]
    },
    {
     "label": "MakeUnique forwards arguments",
     "patterns": [
      "std::forward"
     ]
    }
   ],
   "solution": "#include <cstddef>\n#include <type_traits>\n#include <utility>\n\ntemplate <typename T>\nstruct DefaultDelete {\n    constexpr DefaultDelete() noexcept = default;\n    void operator()(T* p) const noexcept {\n        static_assert(sizeof(T) > 0, \"cannot delete an incomplete type\");\n        delete p;\n    }\n};\n\ntemplate <typename T, typename Deleter = DefaultDelete<T>>\nclass UniquePtr {\n    T* ptr_ = nullptr;\n    [[no_unique_address]] Deleter del_{};   // empty deleters take no space (sizeof == sizeof(T*))\n\npublic:\n    constexpr UniquePtr() noexcept = default;\n    constexpr UniquePtr(std::nullptr_t) noexcept {}\n    explicit UniquePtr(T* p) noexcept : ptr_(p) {}\n    UniquePtr(T* p, Deleter d) noexcept : ptr_(p), del_(std::move(d)) {}\n\n    // Move-only: exactly one owner at any time.\n    UniquePtr(const UniquePtr&) = delete;\n    UniquePtr& operator=(const UniquePtr&) = delete;\n\n    UniquePtr(UniquePtr&& other) noexcept\n        : ptr_(std::exchange(other.ptr_, nullptr)), del_(std::move(other.del_)) {}\n\n    UniquePtr& operator=(UniquePtr&& other) noexcept {\n        if (this != &other) {\n            reset(other.release());            // frees our old object, takes theirs\n            del_ = std::move(other.del_);\n        }\n        return *this;\n    }\n    UniquePtr& operator=(std::nullptr_t) noexcept { reset(); return *this; }\n\n    ~UniquePtr() { if (ptr_) del_(ptr_); }\n\n    // Give up ownership without deleting.\n    [[nodiscard]] T* release() noexcept { return std::exchange(ptr_, nullptr); }\n\n    // Replace the managed object. Store the new pointer BEFORE deleting the old one,\n    // so the object stays consistent even if the old object's destructor touches *this.\n    void reset(T* p = nullptr) noexcept {\n        T* old = std::exchange(ptr_, p);\n        if (old) del_(old);\n    }\n\n    void swap(UniquePtr& other) noexcept {\n        using std::swap;\n        swap(ptr_, other.ptr_);\n        swap(del_, other.del_);\n    }\n\n    T* get() const noexcept { return ptr_; }\n    Deleter& get_deleter() noexcept { return del_; }\n    const Deleter& get_deleter() const noexcept { return del_; }\n    explicit operator bool() const noexcept { return ptr_ != nullptr; }\n    std::add_lvalue_reference_t<T> operator*() const noexcept { return *ptr_; }\n    T* operator->() const noexcept { return ptr_; }\n};\n\ntemplate <typename T, typename... Args>\nUniquePtr<T> MakeUnique(Args&&... args) {\n    return UniquePtr<T>(new T(std::forward<Args>(args)...));\n}\n",
   "tests": "#include <cassert>\n#include <cstdio>\n#include <iostream>\n#include <string>\n#include <type_traits>\n\nstruct Order {\n    static inline int alive = 0;\n    int id; double px;\n    Order(int i, double p) : id(i), px(p) { ++alive; }\n    ~Order() { --alive; }\n};\n\nint deleterCalls = 0;\nstruct CountingDeleter {\n    void operator()(Order* p) const noexcept { ++deleterCalls; delete p; }\n};\n\nint main() {\n    static_assert(!std::is_copy_constructible_v<UniquePtr<int>>);\n    static_assert(!std::is_copy_assignable_v<UniquePtr<int>>);\n    static_assert(std::is_nothrow_move_constructible_v<UniquePtr<int>>);\n    static_assert(sizeof(UniquePtr<int>) == sizeof(int*), \"empty deleter must be free\");\n    {\n        auto a = MakeUnique<Order>(1, 100.5);\n        assert(a && a->id == 1 && (*a).px == 100.5 && Order::alive == 1);\n        UniquePtr<Order> b = std::move(a);         // move ctor\n        assert(!a && b && b->id == 1 && Order::alive == 1);\n        UniquePtr<Order> c;\n        c = std::move(b);                          // move assign into empty\n        assert(!b && c->id == 1);\n        c = MakeUnique<Order>(2, 99.0);            // move assign frees the old object\n        assert(c->id == 2 && Order::alive == 1);\n        UniquePtr<Order>& alias = c;\n        c = std::move(alias);                      // self-move is harmless\n        assert(c && c->id == 2);\n        Order* raw = c.release();\n        assert(!c && Order::alive == 1);\n        c.reset(raw);\n        c.reset(new Order(3, 1.0));                // reset deletes the previous one\n        assert(c->id == 3 && Order::alive == 1);\n        c.reset();\n        assert(!c && Order::alive == 0);\n        c = MakeUnique<Order>(4, 2.0);\n        c = nullptr;\n        assert(Order::alive == 0);\n    }\n    {   // custom stateless deleter\n        {\n            UniquePtr<Order, CountingDeleter> p(new Order(5, 5.0));\n            UniquePtr<Order, CountingDeleter> q(new Order(6, 6.0));\n            p.swap(q);\n            assert(p->id == 6 && q->id == 5);\n        }\n        assert(deleterCalls == 2 && Order::alive == 0);\n    }\n    {   // stateful lambda deleter (e.g. return to a pool, close a file)\n        int returned = 0;\n        auto toPool = [&returned](Order* p) { ++returned; delete p; };\n        {\n            UniquePtr<Order, decltype(toPool)> p(new Order(7, 7.0), toPool);\n            UniquePtr<Order, decltype(toPool)> q(std::move(p));\n            assert(!p && q->id == 7);\n        }\n        assert(returned == 1 && Order::alive == 0);\n    }\n    {   // function-pointer deleter around a C resource\n        std::FILE* f = std::tmpfile();\n        assert(f);\n        UniquePtr<std::FILE, int (*)(std::FILE*)> file(f, &std::fclose);\n        assert(std::fputs(\"x\", file.get()) >= 0);\n    }\n    std::cout << \"ALL TESTS PASSED\\n\";\n}\n",
   "explanation": "### How it works\nThe class holds `T* ptr_` and a `Deleter del_`. Ownership is a single invariant: *if `ptr_` is non-null, this object must eventually call `del_(ptr_)` exactly once.*\n- **Destructor:** `if (ptr_) del_(ptr_);`\n- **Move constructor:** steal the pointer with `std::exchange(other.ptr_, nullptr)` so the source no longer owns it.\n- **Move assignment:** `reset(other.release())`. This deletes our old object, takes theirs, and is automatically safe for self-assignment (with the `this != &other` guard it is also cheap).\n- **`release()`** returns the pointer and nulls ours without deleting; the caller now owns it.\n- **`reset(p)`** stores `p` first and then deletes the old pointer. The order matters: if the old object's destructor somehow reaches back into this `UniquePtr`, it sees a consistent state (this is how the standard specifies it).\n- **Copy is `= delete`**: two owners would mean a double delete.\n\n### Zero overhead\n`[[no_unique_address]] Deleter del_` lets an empty deleter occupy no storage, so `sizeof(UniquePtr<int>) == sizeof(int*)` (the standard library uses the empty-base optimisation for the same effect). A function-pointer deleter costs one extra pointer; a lambda with captures costs its captures. All operations inline away at `-O2`.\n\n### Rule of five / rule of zero\n`UniquePtr` is the canonical \"rule of five\" class (destructor + deleted copy + hand-written moves). Its point is to let *other* classes follow the **rule of zero**: a class whose members are `UniquePtr`s needs no hand-written destructor or move operations.\n\n### Pitfalls\n- Making the move operations not `noexcept`: `std::vector<UniquePtr<T>>` would then refuse to move on reallocation (and since copy is deleted, would not compile in some paths).\n- Implicit conversion from `T*`: make the constructor `explicit`, or `UniquePtr<T> p = rawPtr;` silently takes ownership.\n- `operator bool` must be `explicit`, otherwise `p1 + p2` or `int x = p;` compile.\n- Using `delete` for an array: the standard has a separate `unique_ptr<T[]>` specialisation that calls `delete[]`.\n- `UniquePtr<T>(new T(a), ...)` in function arguments before C++17 could leak if another argument threw; `MakeUnique` avoids that.\n\n### What an interviewer probes\nWhy it costs nothing compared with a raw pointer; why the moves are `noexcept`; how a custom deleter returns an object to a memory pool (`[&pool](Order* o){ std::destroy_at(o); pool.deallocate(o); }`); difference from `shared_ptr` (no control block, no atomics).\n",
   "followUps": [
    "Add a UniquePtr<T[]> specialisation that uses delete[] and offers operator[] instead of operator->.",
    "Support converting moves: UniquePtr<Derived> to UniquePtr<Base>. What must be true of Base's destructor?",
    "Write a deleter that returns the object to a MemoryPool. Why is a lambda deleter with a captured reference bigger than DefaultDelete?",
    "Why does std::vector<std::unique_ptr<T>> require the move constructor to be noexcept for its fast reallocation path?",
    "When is unique_ptr NOT zero-cost? (Passing by value in the Itanium ABI: non-trivially-destructible types are passed in memory, not registers.)"
   ]
  },
  {
   "id": "shared-ptr",
   "title": "SharedPtr with an Atomic Control Block",
   "origin": "practice",
   "difficulty": "Medium",
   "topics": [
    "smart pointers",
    "reference counting",
    "atomics",
    "memory ordering",
    "weak pointers"
   ],
   "sessions": [
    6,
    7
   ],
   "statement": "### Problem Description\nImplement a minimal thread-safe `SharedPtr<T>` with a separately allocated **control block** holding an atomic reference count, plus (for full marks) a `WeakPtr<T>` with `expired()` and `lock()`. Shared ownership appears wherever several threads or components hold the same long-lived object (a reference-data snapshot, a book that the strategy and the risk check both read) and nobody knows who finishes last. The cost is real: every copy and every destruction is an atomic read-modify-write on a shared cache line, which is why latency-sensitive code passes `const SharedPtr&` or moves instead of copying, and why you must understand exactly what the count costs.\n\nThe smart pointer should:\n- allocate one control block per managed object, shared by all copies\n- increment the strong count on copy and decrement it on destruction/reset; the thread that drops the last reference deletes the object\n- move without touching the count\n- be safe when different threads copy and destroy their own `SharedPtr` instances that point to the same object\n- report `use_count()`\n- optional `WeakPtr`: holds a weak count, `lock()` returns an owning `SharedPtr` only if the object is still alive, and the control block lives until the last `WeakPtr` is gone\n\n### Function Signature\n```cpp\ntemplate <typename T>\nclass SharedPtr {\npublic:\n    explicit SharedPtr(T* p);\n    SharedPtr(const SharedPtr& other);\n    SharedPtr(SharedPtr&& other) noexcept;\n    SharedPtr& operator=(const SharedPtr& other);\n    SharedPtr& operator=(SharedPtr&& other) noexcept;\n    ~SharedPtr();\n    void reset();\n    T* get() const;\n    T* operator->() const;\n    long use_count() const;\n};\ntemplate <typename T, typename... Args> SharedPtr<T> MakeShared(Args&&... args);\n```\n\n### Constraints\n- the reference count is a `std::atomic`; increments may be `relaxed`, the final decrement must use acquire-release ordering so the deleting thread sees every other owner's writes\n- the object is deleted exactly once, by whichever thread releases the last strong reference\n- self-assignment is safe; move construction and move assignment do not change the count\n- if the control block allocation throws in the constructor, the raw pointer must not leak\n- `WeakPtr::lock()` must never resurrect an object whose count already reached zero\n- all operations O(1); clean under AddressSanitizer and ThreadSanitizer\n\n### Example\n```cpp\nSharedPtr<Book> a = MakeShared<Book>(10);   // use_count 1\nSharedPtr<Book> b = a;                      // use_count 2\nSharedPtr<Book> c = std::move(b);           // still 2, b is empty\nc.reset();                                  // 1\nWeakPtr<Book> w(a);\na.reset();                                  // Book destroyed here\n// output: w.expired() == true, w.lock() is empty\n```\n",
   "signature": "#include <atomic>\n#include <cstddef>\n#include <utility>\n\n// TODO: per-object bookkeeping, shared by every copy, holding the strong count (optionally a weak count)\n\ntemplate <typename T>\nclass SharedPtr {\n    T* ptr_ = nullptr;\n    // TODO: pointer to that shared bookkeeping\n\npublic:\n    SharedPtr() = default;\n    explicit SharedPtr(T* p);\n    SharedPtr(const SharedPtr& other);             // one more owner\n    SharedPtr(SharedPtr&& other) noexcept;         // ownership moves, count unchanged\n    SharedPtr& operator=(const SharedPtr& other);\n    SharedPtr& operator=(SharedPtr&& other) noexcept;\n    ~SharedPtr();                                  // last owner deletes the object\n\n    void reset();\n    void reset(T* p);\n    T* get() const;\n    T& operator*() const;\n    T* operator->() const;\n    explicit operator bool() const;\n    long use_count() const;\n};\n\n// Optional: WeakPtr<T> with expired() and lock()\n\ntemplate <typename T, typename... Args>\nSharedPtr<T> MakeShared(Args&&... args);\n",
   "hints": [
    "Every SharedPtr copy points to the same heap-allocated control block that holds std::atomic<long> strong. Copy increments, destructor decrements, and whoever takes it from 1 to 0 deletes the object (and the block).",
    "Increment with memory_order_relaxed (you already own a reference). Decrement with memory_order_acq_rel and check whether fetch_sub returned 1. Implement copy assignment as copy-and-swap so self-assignment is safe.",
    "For WeakPtr add a weak count that starts at 1 on behalf of all strong owners. lock() must CAS strong from n to n+1 and give up when it sees 0; never fetch_add from zero."
   ],
   "checks": [
    {
     "label": "Separate control block shared by all copies",
     "patterns": [
      "control",
      "struct\\s+\\w*(block|cb|count)\\w*",
      "\\bcb_?\\b"
     ]
    },
    {
     "label": "Atomic reference count",
     "patterns": [
      "std::atomic\\s*<\\s*(long|int|unsigned|std::size_t|size_t|std::int|uint|int64|long long)"
     ]
    },
    {
     "label": "Copy increments the count",
     "patterns": [
      "fetch_add",
      "\\+\\+\\s*\\w*(count|strong|ref)",
      "\\w*(count|strong|ref)\\w*\\s*\\+\\+"
     ]
    },
    {
     "label": "Last owner (count reaches zero) deletes the object",
     "patterns": [
      "fetch_sub\\s*\\([^)]*\\)\\s*==\\s*1",
      "--\\s*[\\w>.-]*(count|strong|ref)\\w*\\s*==\\s*0"
     ]
    },
    {
     "label": "Final decrement uses acquire/release ordering",
     "patterns": [
      "memory_order_acq_rel",
      "memory_order_release",
      "memory_order::acq_rel",
      "fetch_sub\\s*\\(\\s*1\\s*\\)"
     ]
    },
    {
     "label": "Move constructor steals without touching the count",
     "patterns": [
      "SharedPtr\\s*&&"
     ]
    },
    {
     "label": "Reports use_count()",
     "patterns": [
      "use_count"
     ]
    }
   ],
   "solution": "#include <atomic>\n#include <cstddef>\n#include <utility>\n\n// One control block per managed object, shared by every SharedPtr/WeakPtr to it.\nstruct ControlBlock {\n    std::atomic<long> strong{1};   // number of SharedPtr owners\n    std::atomic<long> weak{1};     // number of WeakPtr + 1 while strong > 0\n    virtual void destroyObject() noexcept = 0;   // runs when strong hits 0\n    virtual ~ControlBlock() = default;           // block itself freed when weak hits 0\n};\n\ntemplate <typename T>\nstruct PtrControlBlock final : ControlBlock {\n    T* obj;\n    explicit PtrControlBlock(T* p) noexcept : obj(p) {}\n    void destroyObject() noexcept override { delete obj; }\n};\n\ntemplate <typename T> class WeakPtr;\n\ntemplate <typename T>\nclass SharedPtr {\n    T* ptr_ = nullptr;\n    ControlBlock* cb_ = nullptr;\n\n    friend class WeakPtr<T>;\n    SharedPtr(T* p, ControlBlock* cb) noexcept : ptr_(p), cb_(cb) {}   // used by WeakPtr::lock\n\n    void releaseRef() noexcept {\n        if (!cb_) return;\n        // acq_rel: the release half publishes our writes to *ptr_; the acquire half (taken by\n        // the thread that drops the last reference) makes all other owners' writes visible\n        // before the destructor runs.\n        if (cb_->strong.fetch_sub(1, std::memory_order_acq_rel) == 1) {\n            cb_->destroyObject();\n            if (cb_->weak.fetch_sub(1, std::memory_order_acq_rel) == 1) delete cb_;\n        }\n        ptr_ = nullptr;\n        cb_ = nullptr;\n    }\n\npublic:\n    constexpr SharedPtr() noexcept = default;\n    constexpr SharedPtr(std::nullptr_t) noexcept {}\n    explicit SharedPtr(T* p) : ptr_(p) {\n        if (!p) return;\n        try { cb_ = new PtrControlBlock<T>(p); }\n        catch (...) { delete p; throw; }        // never leak p if the block cannot be allocated\n    }\n\n    // Copy: one more owner. Incrementing needs no ordering: the new owner got the pointer\n    // from an existing owner, which already synchronises access to the object.\n    SharedPtr(const SharedPtr& o) noexcept : ptr_(o.ptr_), cb_(o.cb_) {\n        if (cb_) cb_->strong.fetch_add(1, std::memory_order_relaxed);\n    }\n    // Move: no refcount traffic at all.\n    SharedPtr(SharedPtr&& o) noexcept\n        : ptr_(std::exchange(o.ptr_, nullptr)), cb_(std::exchange(o.cb_, nullptr)) {}\n\n    // Copy-and-swap handles self-assignment and gives the strong guarantee.\n    SharedPtr& operator=(const SharedPtr& o) noexcept { SharedPtr(o).swap(*this); return *this; }\n    SharedPtr& operator=(SharedPtr&& o) noexcept { SharedPtr(std::move(o)).swap(*this); return *this; }\n\n    ~SharedPtr() { releaseRef(); }\n\n    void reset() noexcept { releaseRef(); }\n    void reset(T* p) { SharedPtr(p).swap(*this); }\n    void swap(SharedPtr& o) noexcept { std::swap(ptr_, o.ptr_); std::swap(cb_, o.cb_); }\n\n    T* get() const noexcept { return ptr_; }\n    T& operator*() const noexcept { return *ptr_; }\n    T* operator->() const noexcept { return ptr_; }\n    explicit operator bool() const noexcept { return ptr_ != nullptr; }\n    long use_count() const noexcept { return cb_ ? cb_->strong.load(std::memory_order_relaxed) : 0; }\n};\n\ntemplate <typename T>\nclass WeakPtr {\n    T* ptr_ = nullptr;\n    ControlBlock* cb_ = nullptr;\n\n    void releaseWeak() noexcept {\n        if (cb_ && cb_->weak.fetch_sub(1, std::memory_order_acq_rel) == 1) delete cb_;\n        ptr_ = nullptr; cb_ = nullptr;\n    }\n\npublic:\n    constexpr WeakPtr() noexcept = default;\n    WeakPtr(const SharedPtr<T>& s) noexcept : ptr_(s.ptr_), cb_(s.cb_) {\n        if (cb_) cb_->weak.fetch_add(1, std::memory_order_relaxed);\n    }\n    WeakPtr(const WeakPtr& o) noexcept : ptr_(o.ptr_), cb_(o.cb_) {\n        if (cb_) cb_->weak.fetch_add(1, std::memory_order_relaxed);\n    }\n    WeakPtr(WeakPtr&& o) noexcept\n        : ptr_(std::exchange(o.ptr_, nullptr)), cb_(std::exchange(o.cb_, nullptr)) {}\n    WeakPtr& operator=(WeakPtr o) noexcept { std::swap(ptr_, o.ptr_); std::swap(cb_, o.cb_); return *this; }\n    ~WeakPtr() { releaseWeak(); }\n\n    bool expired() const noexcept { return !cb_ || cb_->strong.load(std::memory_order_acquire) == 0; }\n\n    // Become an owner only if the object is still alive. A plain fetch_add would resurrect a\n    // dead object (0 -> 1), so we CAS and never increment from zero.\n    SharedPtr<T> lock() const noexcept {\n        if (!cb_) return {};\n        long n = cb_->strong.load(std::memory_order_relaxed);\n        while (n != 0) {\n            if (cb_->strong.compare_exchange_weak(n, n + 1, std::memory_order_acq_rel,\n                                                  std::memory_order_relaxed))\n                return SharedPtr<T>(ptr_, cb_);\n        }\n        return {};\n    }\n};\n\ntemplate <typename T, typename... Args>\nSharedPtr<T> MakeShared(Args&&... args) {\n    return SharedPtr<T>(new T(std::forward<Args>(args)...));\n}\n",
   "tests": "#include <cassert>\n#include <iostream>\n#include <thread>\n#include <vector>\n\nstruct Book {\n    static inline std::atomic<int> alive{0};\n    int levels;\n    explicit Book(int l) : levels(l) { ++alive; }\n    ~Book() { --alive; }\n};\n\nint main() {\n    {\n        SharedPtr<Book> a = MakeShared<Book>(10);\n        assert(a.use_count() == 1 && a->levels == 10);\n        {\n            SharedPtr<Book> b = a;                  // copy\n            assert(a.use_count() == 2 && b.get() == a.get());\n            SharedPtr<Book> c = std::move(b);       // move: no change in count\n            assert(!b && a.use_count() == 2);\n            SharedPtr<Book>& alias = c;\n            c = alias;                              // self copy-assign\n            assert(a.use_count() == 2);\n        }\n        assert(a.use_count() == 1 && Book::alive == 1);\n        SharedPtr<Book> d;\n        d = a;\n        d.reset(new Book(20));                      // d now owns a different Book\n        assert(a.use_count() == 1 && d.use_count() == 1 && Book::alive == 2);\n        d.reset();\n        assert(!d && d.use_count() == 0 && Book::alive == 1);\n    }\n    assert(Book::alive == 0);\n    {   // weak pointers\n        WeakPtr<Book> w;\n        {\n            SharedPtr<Book> s = MakeShared<Book>(5);\n            w = WeakPtr<Book>(s);\n            assert(!w.expired() && s.use_count() == 1);\n            SharedPtr<Book> locked = w.lock();\n            assert(locked && locked->levels == 5 && s.use_count() == 2);\n        }\n        assert(w.expired() && Book::alive == 0);   // object gone, control block still alive\n        assert(!w.lock());\n    }\n    {   // many threads copying and dropping the same pointer\n        SharedPtr<Book> root = MakeShared<Book>(1);\n        WeakPtr<Book> watcher(root);\n        std::vector<std::thread> ts;\n        for (int t = 0; t < 8; ++t)\n            ts.emplace_back([root, watcher] {        // each lambda holds its own copy\n                for (int i = 0; i < 20000; ++i) {\n                    SharedPtr<Book> local = root;\n                    SharedPtr<Book> moved = std::move(local);\n                    SharedPtr<Book> fromWeak = watcher.lock();\n                    assert(moved && fromWeak && moved->levels == 1);\n                }\n            });\n        for (auto& t : ts) t.join();\n        assert(root.use_count() == 1 && Book::alive == 1);\n    }\n    assert(Book::alive == 0);\n    {   // last owner released on another thread while a weak pointer races lock()\n        for (int round = 0; round < 200; ++round) {\n            SharedPtr<Book> s = MakeShared<Book>(round);\n            WeakPtr<Book> w(s);\n            std::thread killer([s = std::move(s)]() mutable { s.reset(); });\n            SharedPtr<Book> maybe = w.lock();\n            if (maybe) assert(maybe->levels == round);\n            killer.join();\n        }\n        assert(Book::alive == 0);\n    }\n    std::cout << \"ALL TESTS PASSED\\n\";\n}\n",
   "explanation": "### How it works\nEach managed object gets a heap-allocated `ControlBlock` with two atomics:\n- `strong`: the number of `SharedPtr` owners. When it drops to 0 the **object** is destroyed.\n- `weak`: the number of `WeakPtr`s **plus one** for the whole group of strong owners. When it drops to 0 the **control block** is freed. The \"+1\" trick means strong owners together hold a single weak reference, so the block outlives the object as long as any `WeakPtr` might still look at it.\n\nCopy = `strong.fetch_add(1, relaxed)`. Destroy/reset = `if (strong.fetch_sub(1, acq_rel) == 1) { destroy object; drop the group's weak ref; }`. Move = steal both pointers, no atomic at all. Assignment uses **copy-and-swap**: construct a temporary, swap, let the temporary's destructor release the old reference. That handles self-assignment for free.\n\n### Why those memory orders\n- **Increment relaxed:** to copy a `SharedPtr` you must already hold one, so the object is guaranteed alive and nothing needs to be ordered.\n- **Decrement acq_rel:** every owner may have written to the object. Its *release* makes those writes visible to whoever performs the final decrement, and the *acquire* in the final decrement ensures the destructor runs after it sees them. (A common optimisation is `fetch_sub(release)` plus `atomic_thread_fence(acquire)` only on the last-owner path.)\n- **`lock()` uses a CAS loop** that refuses to increment from 0. A plain `fetch_add` could turn 0 into 1 after another thread already started destroying the object (use-after-free).\n\n### Thread-safety, precisely\nThe *control block* is thread-safe: different threads may copy/destroy *different* `SharedPtr` instances that share an object. A *single* `SharedPtr` instance read and written by two threads at once is still a data race (that needs `std::atomic<std::shared_ptr<T>>` in C++20). And the pointee itself is not protected at all.\n\n### Costs to mention in an exam\n- Two allocations (object + block). `std::make_shared` puts both in **one** allocation, better for locality, but then the object's memory cannot be freed until the last `weak_ptr` is gone.\n- Every copy is an atomic RMW on a shared cache line: with many threads copying, that line bounces between cores. Pass `const SharedPtr&` or move.\n- `sizeof(SharedPtr) == 2 * sizeof(void*)`.\n\n### Pitfalls\n- Creating two `SharedPtr`s from the same raw pointer: two control blocks, double delete. (`enable_shared_from_this` exists for this reason.)\n- Cycles of `SharedPtr` never reach 0: break them with `WeakPtr`.\n- Using a non-atomic `int` count: TSan flags it immediately and objects are freed twice or never.\n",
   "followUps": [
    "Implement MakeShared with a single allocation that holds both the control block and the object (aligned storage inside the block). What happens to the object's memory while a WeakPtr is still alive?",
    "Add a custom deleter and allocator to the control block (type erasure via a virtual function or function pointer).",
    "Why is a single SharedPtr instance shared between threads still a race, and what does std::atomic<std::shared_ptr<T>> (C++20) do about it?",
    "Implement enable_shared_from_this. Why does it need a WeakPtr member?",
    "Benchmark: 8 threads copying one SharedPtr in a loop versus each thread holding its own copy. Explain the difference with cache-line ownership."
   ]
  },
  {
   "id": "sso-string",
   "title": "String with Small-String Optimisation",
   "origin": "practice",
   "difficulty": "Hard",
   "topics": [
    "move semantics",
    "rule of five",
    "small-string optimisation",
    "union",
    "memory layout"
   ],
   "sessions": [
    6
   ],
   "statement": "### Problem Description\nImplement a `String` class with the **small-string optimisation (SSO)** and full move semantics. Most strings in a trading system are short (symbols such as `\"AAPL\"`, venue codes, client order ids), and a naive string class calls `new` for every one of them, putting an allocator call on the hot path for a four-byte payload. With SSO, strings up to 15 characters live in a buffer **inside the object**, and only longer strings go to the heap. Move semantics then make passing long strings around cheap (steal the heap pointer) while short strings are simply copied.\n\nThe class should:\n- store strings of length 15 or less inline, with no heap allocation\n- store longer strings in a heap block, tracking size and capacity\n- follow the rule of five: deep copy, noexcept move (steal the heap block, or copy the inline bytes), copy and move assignment, destructor\n- leave a moved-from string valid and empty\n- keep `c_str()` null-terminated at all times\n- grow geometrically on `push_back` / `+=`, moving from inline to heap when needed\n\n### Function Signature\n```cpp\nclass String {\npublic:\n    String();\n    String(const char* s);\n    String(const String& other);\n    String(String&& other) noexcept;\n    String& operator=(const String& other);\n    String& operator=(String&& other) noexcept;\n    ~String();\n    std::size_t size() const;\n    std::size_t capacity() const;\n    bool is_inline() const;\n    const char* c_str() const;\n    char& operator[](std::size_t i);\n    void push_back(char c);\n    String& operator+=(const char* s);\n};\n```\n\n### Constraints\n- `sizeof(String) == 32` on a 64-bit platform (pointer + size + 16-byte buffer that doubles as the capacity field)\n- no heap allocation for strings of length <= 15, including after copy and move\n- moving a long string performs no allocation and the moved-to string reuses the same buffer\n- move constructor and move assignment are `noexcept`; self-assignment is safe\n- `s += s` (appending a string to itself) works\n- `push_back` is amortised O(1)\n\n### Example\n```cpp\nString a = \"AAPL\";                 // inline, no heap\nString b = \"a long instrument description\";   // heap\nString c = std::move(b);           // pointer stolen, b becomes \"\"\nString d = a;                      // inline copy\nd += \" US Equity\";                 // 14 chars: still inline\n// output: a.is_inline() == true, c.is_inline() == false,\n//         b.size() == 0, d.c_str() == \"AAPL US Equity\"\n```\n",
   "signature": "#include <cstddef>\n#include <cstring>\n\nclass String {\n    // TODO: representation with a small inline buffer (15 chars + '\\0')\n    //       and a heap pointer + capacity for longer strings\n\npublic:\n    String();\n    String(const char* s);\n\n    String(const String& other);                 // deep copy\n    String(String&& other) noexcept;             // steal the heap block, or copy the inline bytes\n    String& operator=(const String& other);\n    String& operator=(String&& other) noexcept;\n    ~String();\n\n    std::size_t size() const;\n    std::size_t capacity() const;\n    bool is_inline() const;                      // true when no heap memory is used\n    const char* c_str() const;\n    char& operator[](std::size_t i);\n    void push_back(char c);\n    String& operator+=(const char* s);\n};\n",
   "hints": [
    "Layout: char* data_, size_t size_, and a union of { size_t cap_; char buf_[16]; }. A string is small exactly when data_ == buf_, so c_str() never branches.",
    "Copy allocates only for long strings. Move steals data_ when the source is on the heap, but for a small source copies the 16 bytes and points data_ at YOUR OWN buf_. Then reset the source to an empty small string.",
    "Implement assignment with copy-and-swap, delete[] only when not small, grow by doubling, and handle s += s by turning the source pointer into an offset before reallocating."
   ],
   "checks": [
    {
     "label": "Inline buffer for short strings",
     "patterns": [
      "\\w*(buf|sso|local|small|inline)\\w*\\s*\\[\\s*(\\w+\\s*\\+\\s*1|16|15|24|23|kSso\\w*)\\s*\\]"
     ]
    },
    {
     "label": "Distinguishes small from heap representation",
     "patterns": [
      "isSmall|is_small|is_inline|isInline|data_\\s*==\\s*buf_|onHeap|on_heap|is_heap|isHeap|isLong|is_long"
     ]
    },
    {
     "label": "Allocates on the heap only for long strings",
     "patterns": [
      "new\\s+char\\s*\\["
     ]
    },
    {
     "label": "Frees the heap block in the destructor",
     "patterns": [
      "delete\\s*\\[\\s*\\]"
     ]
    },
    {
     "label": "Move constructor is noexcept",
     "patterns": [
      "String\\s*&&\\s*\\w*\\s*\\)\\s*noexcept"
     ]
    },
    {
     "label": "Leaves the moved-from string empty",
     "patterns": [
      "setSmallEmpty|size_\\s*=\\s*0|=\\s*nullptr|\\[\\s*0\\s*\\]\\s*=\\s*'\\\\0'"
     ]
    },
    {
     "label": "Handles self-assignment",
     "patterns": [
      "this\\s*!=\\s*&",
      "swap"
     ]
    },
    {
     "label": "Copies bytes with memcpy/memmove or a loop",
     "patterns": [
      "memcpy",
      "memmove",
      "std::copy",
      "for\\s*\\("
     ]
    }
   ],
   "solution": "#include <algorithm>\n#include <cstddef>\n#include <cstring>\n#include <utility>\n\nclass String {\n    static constexpr std::size_t kSso = 15;   // chars that fit inline (+1 for '\\0')\n\n    char* data_;          // points at buf_ (small) or at a heap block (large)\n    std::size_t size_;\n    union {\n        std::size_t cap_;       // active when on the heap\n        char buf_[kSso + 1];    // active when small\n    };\n\n    bool isSmall() const noexcept { return data_ == buf_; }\n    void setSmallEmpty() noexcept { data_ = buf_; size_ = 0; buf_[0] = '\\0'; }\n\n    void init(const char* s, std::size_t n) {\n        if (n <= kSso) {\n            data_ = buf_;\n            buf_[0] = '\\0';                      // makes buf_ the active union member\n        } else {\n            data_ = new char[n + 1];             // only long strings touch the heap\n            cap_ = n;\n        }\n        std::memcpy(data_, s, n);\n        data_[n] = '\\0';\n        size_ = n;\n    }\n\npublic:\n    String() noexcept { setSmallEmpty(); }\n    String(const char* s) { init(s, std::strlen(s)); }\n    String(const char* s, std::size_t n) { init(s, n); }\n\n    // Rule of five.\n    String(const String& o) { init(o.data_, o.size_); }               // deep copy\n\n    String(String&& o) noexcept {\n        if (o.isSmall()) {\n            // Cannot steal: the bytes live inside `o`. Copy them (at most 16 bytes).\n            data_ = buf_;\n            std::memcpy(buf_, o.buf_, kSso + 1);\n            size_ = o.size_;\n        } else {\n            data_ = o.data_;                     // steal the heap block\n            size_ = o.size_;\n            cap_ = o.cap_;\n        }\n        o.setSmallEmpty();                       // leave the source valid and empty\n    }\n\n    String& operator=(const String& o) {\n        if (this != &o) { String tmp(o); swap(tmp); }   // copy-and-swap: strong guarantee\n        return *this;\n    }\n    String& operator=(String&& o) noexcept {\n        if (this != &o) { String tmp(std::move(o)); swap(tmp); }\n        return *this;\n    }\n\n    ~String() { if (!isSmall()) delete[] data_; }\n\n    void swap(String& o) noexcept {\n        String* a = this; String* b = &o;\n        if (a->isSmall() && b->isSmall()) {\n            char t[kSso + 1];\n            std::memcpy(t, a->buf_, kSso + 1);\n            std::memcpy(a->buf_, b->buf_, kSso + 1);\n            std::memcpy(b->buf_, t, kSso + 1);\n            std::swap(a->size_, b->size_);\n        } else if (!a->isSmall() && !b->isSmall()) {\n            std::swap(a->data_, b->data_);\n            std::swap(a->size_, b->size_);\n            std::swap(a->cap_, b->cap_);\n        } else {\n            if (a->isSmall()) std::swap(a, b);    // now a is large, b is small\n            char* heap = a->data_; std::size_t cap = a->cap_, sz = a->size_;\n            a->data_ = a->buf_;\n            std::memcpy(a->buf_, b->buf_, kSso + 1);   // fix the self-pointer: data_ = OWN buf_\n            a->size_ = b->size_;\n            b->data_ = heap; b->cap_ = cap; b->size_ = sz;\n        }\n    }\n\n    std::size_t size() const noexcept { return size_; }\n    std::size_t capacity() const noexcept { return isSmall() ? kSso : cap_; }\n    bool empty() const noexcept { return size_ == 0; }\n    bool is_inline() const noexcept { return isSmall(); }\n    const char* c_str() const noexcept { return data_; }\n    char& operator[](std::size_t i) noexcept { return data_[i]; }\n    const char& operator[](std::size_t i) const noexcept { return data_[i]; }\n\n    void reserve(std::size_t n) {\n        if (n <= capacity()) return;\n        char* p = new char[n + 1];\n        std::memcpy(p, data_, size_ + 1);\n        if (!isSmall()) delete[] data_;\n        data_ = p;\n        cap_ = n;                                  // heap now active\n    }\n\n    String& append(const char* s, std::size_t n) {\n        if (size_ + n > capacity()) {\n            // s may point into our own buffer (s += s). Remember it as an offset,\n            // because reserve() frees the old buffer.\n            const bool aliased = s >= data_ && s <= data_ + size_;\n            const std::size_t off = aliased ? static_cast<std::size_t>(s - data_) : 0;\n            reserve(std::max(size_ + n, 2 * capacity()));   // geometric growth\n            if (aliased) s = data_ + off;\n        }\n        std::memmove(data_ + size_, s, n);         // memmove: source and destination may overlap\n        size_ += n;\n        data_[size_] = '\\0';\n        return *this;\n    }\n    String& operator+=(const String& o) { return append(o.data_, o.size_); }\n    String& operator+=(const char* s) { return append(s, std::strlen(s)); }\n    void push_back(char c) { append(&c, 1); }\n\n    friend bool operator==(const String& a, const String& b) noexcept {\n        return a.size_ == b.size_ && std::memcmp(a.data_, b.data_, a.size_) == 0;\n    }\n};\n",
   "tests": "#include <cassert>\n#include <cstring>\n#include <iostream>\n#include <string>\n#include <utility>\n#include <vector>\n\nint main() {\n    static_assert(sizeof(String) == 32, \"pointer + size + 16-byte buffer\");\n    {   // small strings stay inline\n        String a = \"AAPL\";\n        assert(a.is_inline() && a.size() == 4 && std::strcmp(a.c_str(), \"AAPL\") == 0);\n        String b = \"exactly15chars!\";              // 15 = boundary\n        assert(b.size() == 15 && b.is_inline());\n        String c = \"sixteen chars!!!\";             // 16 -> heap\n        assert(c.size() == 16 && !c.is_inline());\n        String e;\n        assert(e.empty() && e.c_str()[0] == '\\0');\n    }\n    {   // copy is deep for both representations\n        String s = \"MSFT\";\n        String l = \"a long instrument description string\";\n        String s2 = s, l2 = l;\n        s2[0] = 'X'; l2[0] = 'X';\n        assert(s[0] == 'M' && l[0] == 'a');\n        assert(l2.c_str() != l.c_str());\n    }\n    {   // move: steals the heap block, copies the inline buffer\n        String l = \"a long instrument description string\";\n        const char* heap = l.c_str();\n        String m = std::move(l);\n        assert(m.c_str() == heap);                 // no allocation, pointer stolen\n        assert(l.empty() && l.is_inline());        // source left valid and empty\n        String s = \"IBM\";\n        String ms = std::move(s);\n        assert(ms.is_inline() && ms.c_str() != s.c_str() && ms == String(\"IBM\"));\n        // a moved small string must point at ITS OWN buffer\n        assert(ms.c_str() == reinterpret_cast<const char*>(&ms) + 16);\n    }\n    {   // assignments in every combination, including self-assignment\n        String a = \"short\", b = \"this one is definitely long\", c;\n        c = a; assert(c == a && c.is_inline());\n        c = b; assert(c == b && !c.is_inline());\n        c = a; assert(c == a && c.is_inline());\n        String& alias = c;\n        c = alias; assert(c == a);\n        c = std::move(b); assert(c == String(\"this one is definitely long\") && b.empty());\n        c = std::move(alias); assert(c.size() == 27);\n        a.swap(c); assert(a.size() == 27 && c == String(\"short\"));\n        a.swap(c); assert(a == String(\"short\") && c.size() == 27);\n    }\n    {   // growth from inline to heap, and aliasing append\n        String s;\n        std::string ref;\n        for (int i = 0; i < 200; ++i) { s.push_back(static_cast<char>('a' + i % 26)); ref.push_back(static_cast<char>('a' + i % 26)); }\n        assert(s.size() == 200 && ref == s.c_str());\n        String t = \"abc\";\n        t += t; t += t;                            // appending to itself\n        assert(t == String(\"abcabcabcabc\"));\n        String u = \"0123456789\";                   // 10 chars inline\n        u += u;                                    // 20 chars: must reallocate while reading itself\n        assert(!u.is_inline() && u == String(\"01234567890123456789\"));\n        u += u;\n        assert(u.size() == 40 && std::strcmp(u.c_str() + 20, \"01234567890123456789\") == 0);\n        t += \" and much more text to spill\";\n        assert(!t.is_inline() && std::strcmp(t.c_str(), \"abcabcabcabc and much more text to spill\") == 0);\n    }\n    {   // inside a vector (relocations use the noexcept move)\n        std::vector<String> v;\n        for (int i = 0; i < 100; ++i) v.emplace_back(i % 2 ? \"tiny\" : \"a string long enough for the heap\");\n        assert(v[98] == String(\"a string long enough for the heap\") && v[99] == String(\"tiny\"));\n        static_assert(std::is_nothrow_move_constructible_v<String>);\n    }\n    std::cout << \"ALL TESTS PASSED\\n\";\n}\n",
   "explanation": "### Layout\n```cpp\nchar* data_;                 // -> buf_ (small) or heap\nstd::size_t size_;\nunion { std::size_t cap_; char buf_[16]; };\n```\nThat is 8 + 8 + 16 = 32 bytes, the same layout as libstdc++'s `std::string`. The capacity is only needed when the string is on the heap, so it shares storage with the inline buffer. \"Am I small?\" is simply `data_ == buf_`, so `c_str()` and `operator[]` are a single load with no branch.\n\n### Rule of five, and why SSO makes move interesting\n- **Copy:** allocate only if the source is long, then `memcpy`.\n- **Move, long source:** steal `data_`/`cap_`, O(1), no allocation. Then reset the source to \"empty small\", so its destructor does nothing and it is still usable.\n- **Move, short source:** you **cannot** steal, because the characters live inside the source object. Copy the 16 bytes and point `data_` at **your own** `buf_`. Copying `data_` from the source is the classic SSO bug: the new string would point into the old object's buffer (a dangling pointer once the source dies, caught by ASan as stack-use-after-scope or heap-use-after-free).\n- **Assignment:** copy-and-swap (`String tmp(o); swap(tmp);`) handles self-assignment and gives the strong exception guarantee. `swap` must also fix the self-pointer when it exchanges a small string with a large one.\n- **Destructor:** `delete[]` only when not small.\n\nSo a move of a short string is not \"free\", but it is a 16-byte copy, still far cheaper than an allocation.\n\n### Union rules\nOnly one union member is \"active\". The code assigns `buf_[0]` (which, for a built-in assignment to an array element of a union member, makes `buf_` active) or `cap_` before using them, and only reads the member that is active (`cap_` only when on the heap). Reading the other one would be undefined behaviour.\n\n### Growth and aliasing\n`append` grows to `max(needed, 2 * capacity)`, so `push_back` is amortised O(1). The subtle case is `s += s`: the source pointer points into our own buffer, and `reserve()` frees that buffer. The solution detects that `s` lies inside `[data_, data_ + size_]`, remembers it as an **offset**, and rebuilds the pointer after reallocating. Copying uses `memmove` because source and destination may overlap. (Forget this and ASan reports heap-use-after-free on the second self-append.)\n\n### What an interviewer probes\nWhy 15 characters; how you tell small from large; why a moved-from small string still costs a copy; why the move constructor must be `noexcept` (`std::vector` relocation); what `std::string_view` adds (non-owning, no allocation at all).\n",
   "followUps": [
    "Squeeze the layout to 24 bytes like libc++ (use one bit of the size or capacity as the small/large flag, 22 inline chars). What do you gain and what gets slower?",
    "Make operator+ efficient for chains like a + b + c (rvalue overloads that append into the left operand).",
    "Add a String(std::string_view) constructor and conversion to std::string_view. Why is string_view so popular on hot paths?",
    "Why must the move constructor be noexcept for std::vector<String> to move rather than copy on reallocation?",
    "What does copy-on-write (pre-C++11 libstdc++) do, and why did C++11 effectively forbid it?"
   ]
  },
  {
   "id": "lock-free-stack",
   "title": "Lock-Free Treiber Stack with an ABA Guard",
   "origin": "practice",
   "difficulty": "Hard",
   "topics": [
    "lock-free",
    "compare-and-swap",
    "ABA problem",
    "memory reclamation",
    "memory ordering"
   ],
   "sessions": [
    10
   ],
   "statement": "### Problem Description\nImplement a bounded lock-free stack (a **Treiber stack**) that any number of threads can push to and pop from concurrently, with no mutex. Lock-free structures matter in low-latency systems because a thread holding a lock can be preempted, and then every other thread waits for the scheduler; with compare-and-swap, some thread always makes progress. The textbook Treiber stack (`head.compare_exchange_weak(node->next, node)`) has two famous problems that this exercise asks you to solve: the **ABA problem** (head changes from A to B and back to A between your load and your CAS, so the CAS succeeds with a stale `next`), and **memory reclamation** (a popping thread may read `head->next` after another thread has already deleted that node).\n\nThe stack should:\n- support `push()` and `pop()` from many threads at once, using `compare_exchange` loops (no locks)\n- never allocate after construction: nodes come from a fixed array of `Capacity` nodes, recycled through a free list\n- be immune to ABA, for example by packing a node index and a version tag into one 64-bit atomic and bumping the tag on every successful CAS\n- never dereference freed memory\n- use acquire/release ordering so that a popped value is fully visible to the popping thread\n\n### Function Signature\n```cpp\ntemplate <typename T, std::size_t Capacity>\nclass LockFreeStack {\npublic:\n    LockFreeStack();\n    template <typename U> bool push(U&& value);\n    std::optional<T> pop();\n    bool empty() const;\n};\n```\n\n### Constraints\n- `push` returns `false` when all `Capacity` nodes are in use; `pop` returns `std::nullopt` when the stack is empty\n- LIFO order for a single thread\n- with many threads, every successfully pushed value is popped exactly once (no loss, no duplication)\n- no `new`/`delete` after construction; the head must be lock-free (`std::atomic<std::uint64_t>::is_always_lock_free`)\n- clean under ThreadSanitizer and AddressSanitizer\n\n### Example\n```cpp\nLockFreeStack<int, 3> s;\ns.push(1); s.push(2); s.push(3);\nbool ok = s.push(4);         // false: full\nauto a = s.pop();            // 3\nauto b = s.pop();            // 2\n// output: ok == false, a == 3, b == 2, then pop() gives 1, then std::nullopt\n```\n",
   "signature": "#include <atomic>\n#include <cstddef>\n#include <optional>\n\n// Bounded lock-free stack, safe for many pushing and many popping threads.\ntemplate <typename T, std::size_t Capacity>\nclass LockFreeStack {\n    // TODO: node storage that is never given back to the OS while the stack exists\n    // TODO: an atomic top-of-stack that a pop-push-pop race (A-B-A) cannot fool\n\npublic:\n    LockFreeStack();\n    LockFreeStack(const LockFreeStack&) = delete;\n    LockFreeStack& operator=(const LockFreeStack&) = delete;\n\n    template <typename U>\n    bool push(U&& value);      // false when all Capacity nodes are in use\n    std::optional<T> pop();    // std::nullopt when empty\n    bool empty() const;\n};\n",
   "hints": [
    "Start from the textbook push: set node.next = head, then loop `while (!head.compare_exchange_weak(expected, node))`. On failure the CAS reloads `expected` for you.",
    "Avoid freeing nodes: keep a fixed array of nodes and a second lock-free stack of free node indices. push pops a free node, fills it, and pushes it on the main stack; pop does the reverse.",
    "Beat ABA by packing {tag, index} into one std::atomic<std::uint64_t> and incrementing the tag on every successful CAS. Make node.next a std::atomic so a stale read is not a data race, and use release on push / acquire on pop."
   ],
   "checks": [
    {
     "label": "Uses a compare-and-swap loop",
     "patterns": [
      "compare_exchange_(weak|strong)"
     ]
    },
    {
     "label": "Guards against ABA (tag / version counter / hazard pointer)",
     "patterns": [
      "tag",
      "version",
      "counter",
      "hazard",
      "aba",
      "epoch"
     ]
    },
    {
     "label": "Atomic head",
     "patterns": [
      "std::atomic\\s*<[^>]*>\\s*\\w*head"
     ]
    },
    {
     "label": "Release ordering when publishing a push",
     "patterns": [
      "memory_order_release",
      "memory_order_acq_rel",
      "memory_order::release"
     ]
    },
    {
     "label": "Acquire ordering when popping",
     "patterns": [
      "memory_order_acquire",
      "memory_order_acq_rel",
      "memory_order::acquire"
     ]
    },
    {
     "label": "Handles empty stack",
     "patterns": [
      "nullopt",
      "return\\s+false",
      "nullptr"
     ]
    },
    {
     "label": "No allocation per push (preallocated nodes / free list)",
     "patterns": [
      "std::array",
      "free",
      "pool",
      "\\[\\s*Capacity\\s*\\]"
     ]
    }
   ],
   "solution": "#include <array>\n#include <atomic>\n#include <cstddef>\n#include <cstdint>\n#include <optional>\n#include <type_traits>\n#include <utility>\n\n// Bounded lock-free (Treiber) stack for many producers and many consumers.\n//\n// ABA fix: nodes live in a fixed array and are addressed by 32-bit index. The head is a\n// single 64-bit word {index, tag}; every successful CAS bumps the tag, so a head that was\n// popped and pushed back between our load and our CAS no longer compares equal.\n// Memory reclamation: nodes are never freed while the stack exists (they are recycled\n// through a second lock-free stack of free nodes), so reading a node that another thread\n// has just popped is always reading valid memory.\ntemplate <typename T, std::size_t Capacity>\nclass LockFreeStack {\n    static_assert(Capacity >= 1 && Capacity < 0xFFFFFFFFu, \"index must fit in 32 bits\");\n    static_assert(std::is_default_constructible_v<T> && std::is_move_assignable_v<T>);\n    static constexpr std::uint32_t kNil = 0xFFFFFFFFu;\n\n    struct Node {\n        T value{};\n        std::atomic<std::uint32_t> next{kNil};   // atomic: a stale reader may race a writer\n    };\n\n    static constexpr std::uint64_t pack(std::uint32_t idx, std::uint32_t tag) noexcept {\n        return (static_cast<std::uint64_t>(tag) << 32) | idx;\n    }\n    static constexpr std::uint32_t indexOf(std::uint64_t h) noexcept { return static_cast<std::uint32_t>(h); }\n    static constexpr std::uint32_t tagOf(std::uint64_t h) noexcept { return static_cast<std::uint32_t>(h >> 32); }\n\n    std::array<Node, Capacity> nodes_;\n    alignas(64) std::atomic<std::uint64_t> head_{pack(kNil, 0)};   // stack of elements\n    alignas(64) std::atomic<std::uint64_t> free_{pack(kNil, 0)};   // stack of free nodes\n    static_assert(std::atomic<std::uint64_t>::is_always_lock_free);\n\n    void pushNode(std::atomic<std::uint64_t>& top, std::uint32_t idx) noexcept {\n        std::uint64_t old = top.load(std::memory_order_relaxed);\n        for (;;) {\n            nodes_[idx].next.store(indexOf(old), std::memory_order_relaxed);\n            // release: publishes node.value and node.next to whoever pops this node\n            if (top.compare_exchange_weak(old, pack(idx, tagOf(old) + 1),\n                                          std::memory_order_release, std::memory_order_relaxed))\n                return;\n            // on failure `old` was reloaded; just retry\n        }\n    }\n\n    std::uint32_t popNode(std::atomic<std::uint64_t>& top) noexcept {\n        std::uint64_t old = top.load(std::memory_order_acquire);\n        for (;;) {\n            const std::uint32_t idx = indexOf(old);\n            if (idx == kNil) return kNil;\n            // May read a stale `next` if another thread popped idx meanwhile: harmless,\n            // because then the tag changed and the CAS below fails.\n            const std::uint32_t next = nodes_[idx].next.load(std::memory_order_relaxed);\n            if (top.compare_exchange_weak(old, pack(next, tagOf(old) + 1),\n                                          std::memory_order_acquire, std::memory_order_acquire))\n                return idx;\n        }\n    }\n\npublic:\n    LockFreeStack() {\n        for (std::uint32_t i = 0; i < Capacity; ++i) pushNode(free_, i);\n    }\n    LockFreeStack(const LockFreeStack&) = delete;\n    LockFreeStack& operator=(const LockFreeStack&) = delete;\n\n    // Returns false when all Capacity nodes are in use. Never allocates.\n    template <typename U>\n    bool push(U&& v) {\n        const std::uint32_t idx = popNode(free_);\n        if (idx == kNil) return false;\n        nodes_[idx].value = std::forward<U>(v);   // we own the node exclusively here\n        pushNode(head_, idx);\n        return true;\n    }\n\n    std::optional<T> pop() {\n        const std::uint32_t idx = popNode(head_);\n        if (idx == kNil) return std::nullopt;\n        std::optional<T> out(std::move(nodes_[idx].value));   // exclusive owner again\n        pushNode(free_, idx);\n        return out;\n    }\n\n    bool empty() const noexcept { return indexOf(head_.load(std::memory_order_acquire)) == kNil; }\n};\n",
   "tests": "#include <algorithm>\n#include <cassert>\n#include <iostream>\n#include <string>\n#include <thread>\n#include <vector>\n\nint main() {\n    {   // LIFO semantics, capacity, reuse\n        LockFreeStack<int, 3> s;\n        assert(s.empty() && !s.pop());\n        assert(s.push(1) && s.push(2) && s.push(3));\n        assert(!s.push(4));                      // full\n        assert(*s.pop() == 3 && *s.pop() == 2);\n        assert(s.push(5));\n        assert(*s.pop() == 5 && *s.pop() == 1 && !s.pop() && s.empty());\n        for (int i = 0; i < 1000; ++i) { assert(s.push(i)); assert(*s.pop() == i); }\n    }\n    {   // non-trivial payload\n        LockFreeStack<std::string, 4> s;\n        s.push(std::string(64, 'q'));\n        auto v = s.pop();\n        assert(v && v->size() == 64);\n    }\n    {   // MPMC stress: every pushed value is popped exactly once\n        constexpr int kThreads = 4, kPerThread = 50000;\n        static LockFreeStack<int, 256> s;\n        std::vector<std::vector<int>> got(kThreads);\n        std::vector<std::thread> ts;\n        for (int t = 0; t < kThreads; ++t)\n            ts.emplace_back([t, &got] {\n                for (int i = 0; i < kPerThread; ++i) {\n                    const int v = t * kPerThread + i;\n                    while (!s.push(v)) {               // full: help by popping\n                        if (auto x = s.pop()) got[t].push_back(*x);\n                    }\n                    if (i % 2 == 0) if (auto x = s.pop()) got[t].push_back(*x);\n                }\n            });\n        for (auto& th : ts) th.join();\n        std::vector<int> all;\n        for (auto& g : got) all.insert(all.end(), g.begin(), g.end());\n        while (auto x = s.pop()) all.push_back(*x);\n        std::sort(all.begin(), all.end());\n        assert(static_cast<int>(all.size()) == kThreads * kPerThread);\n        for (int i = 0; i < kThreads * kPerThread; ++i) assert(all[i] == i);\n    }\n    std::cout << \"ALL TESTS PASSED\\n\";\n}\n",
   "explanation": "### The textbook version and its bugs (compare with the class code)\n```cpp\nvoid push(Node* n) {\n    n->next = head.load();\n    while (!head.compare_exchange_weak(n->next, n)) {}   // note the \"!\"\n}\nNode* pop() {\n    Node* old = head.load();\n    while (old && !head.compare_exchange_weak(old, old->next)) {}  // reads old->next\n    return old;\n}\n```\n`compare_exchange_weak(expected, desired)` returns `true` on success and on failure writes the current value into `expected`, so the loop must be `while (!cas(...))` (the version written in class loops while it *succeeds*). Two real problems remain:\n1. **Reclamation:** between loading `old` and reading `old->next`, another thread can pop `old` and `delete` it, so `old->next` is a use-after-free.\n2. **ABA:** thread 1 reads head = A, next = B. Thread 2 pops A, pops B, pushes A back. Head is A again, so thread 1's CAS succeeds and installs B, which is no longer in the stack.\n\n### The fix used here\n- **Nodes are never freed:** they live in `std::array<Node, Capacity>` and are recycled through a *second* Treiber stack of free nodes. Reading a node that someone else just popped reads valid memory (maybe a stale value, never freed memory). `next` is a `std::atomic<uint32_t>` so that this stale read is not a data race.\n- **Tagged head:** the head is one `std::atomic<uint64_t>` holding `{32-bit tag, 32-bit index}`. Every successful CAS increments the tag, so \"A again\" is `{A, tag+2}`, which does not compare equal to the `{A, tag}` thread 1 loaded; its CAS fails and it retries with fresh values. A 32-bit tag can in theory wrap around between one thread's load and CAS (4 billion operations), which is accepted in practice.\n- Using indices instead of pointers is what makes the tag fit in a single 8-byte word, so it works with an ordinary 64-bit CAS on every platform. (The pointer version needs a 16-byte `cmpxchg16b`/`casp` double-width CAS.)\n\n### Memory ordering\n`push` writes `node.value` and `node.next`, then CASes head with **release**. `pop` loads head with **acquire** (and the successful CAS is acquire), so the popping thread sees the value written before the push. A successful pop gives the thread exclusive ownership of that node until it pushes it back onto the free list, so reading/moving `value` needs no further synchronisation.\n\n### Other ABA / reclamation fixes worth naming\n- **Hazard pointers:** each thread publishes the node it is about to dereference; a node is freed only when no hazard pointer refers to it (standardised in C++26 as `std::hazard_pointer`).\n- **Epoch-based reclamation / RCU:** free nodes only after every thread has passed a quiescent point.\n- **Reference counting** of nodes (split counts), as in *C++ Concurrency in Action*.\n- **Double-width CAS** of `{pointer, counter}`.\n\n### Complexity and caveats\nLock-free, not wait-free: under contention a thread may retry many times, and the single head cache line is a hot spot, so a lock-free stack does not scale to many cores. It still avoids the convoy and priority-inversion problems of a mutex. `compare_exchange_weak` may fail spuriously (LL/SC on ARM), which is fine inside a loop.\n",
   "followUps": [
    "Rewrite it with real pointers and a 16-byte {Node*, counter} head. When is std::atomic<that struct> lock-free (check is_always_lock_free and compile flags such as -mcx16)?",
    "Replace the never-free rule with hazard pointers so nodes can be deleted. What does each thread publish, and when is a retired node safe to free?",
    "Why does a lock-free stack scale badly on many cores even though nobody blocks? What does an elimination-backoff stack do?",
    "Which operations are lock-free and which are wait-free? Can you make push wait-free?",
    "Use the same free-list idea to make the MemoryPool thread-safe without a mutex."
   ]
  },
  {
   "id": "order-book",
   "title": "Price-Time Priority Order Book",
   "origin": "practice",
   "difficulty": "Hard",
   "topics": [
    "order book",
    "matching engine",
    "std::map",
    "hash map",
    "iterator stability",
    "capstone"
   ],
   "sessions": [
    12,
    14
   ],
   "statement": "### Problem Description\nImplement a limit order book for one instrument with a **price-time priority** matching engine. The order book is the core data structure of every exchange and every market-making system: bids (buy orders) and asks (sell orders) rest at price levels, the best bid is the highest buy price, the best ask the lowest sell price, and an incoming order that crosses the spread trades against resting orders, best price first and, within a price, oldest first. Real books see millions of adds and cancels per second, and most orders are cancelled before they ever trade, so **cancel must be O(1)** and the best price must be available without a search.\n\nThe book should:\n- keep bids sorted by descending price and asks by ascending price (for example `std::map<Price, Level, std::greater<>>` for bids)\n- keep a FIFO queue of orders at each price level (a `std::list` or `std::deque`) plus the level's total quantity\n- keep a hash map from order id to the order's location (side, price, list iterator) so `cancel` needs no search\n- in `addLimit`, match an incoming order against the opposite side while prices cross, generating fills at the **resting** order's price, then rest any remainder at its limit price\n- leave partially filled resting orders at the front of their queue, and remove empty price levels\n\n### Function Signature\n```cpp\nclass OrderBook {\npublic:\n    std::vector<Fill> addLimit(OrderId id, Side side, Price price, Qty qty);\n    bool cancel(OrderId id);\n    std::optional<Price> bestBid() const;\n    std::optional<Price> bestAsk() const;\n    Qty volumeAt(Side side, Price price) const;\n    std::size_t orderCount() const;\n};\n```\n\n### Constraints\n- prices are integer ticks (never `double`); quantities are positive\n- `addLimit` throws `std::invalid_argument` for a duplicate live order id or `qty <= 0`\n- `cancel` returns `false` for unknown or already filled ids; it is O(1) average (plus O(log L) if a level becomes empty)\n- `bestBid`/`bestAsk` are O(1); adding at an existing price is O(log L) where L is the number of levels\n- after every call the book is never crossed: best bid < best ask\n\n### Example\n```cpp\nOrderBook book;\nbook.addLimit(1, Side::Sell, 101, 50);\nbook.addLimit(2, Side::Sell, 101, 30);\nbook.addLimit(3, Side::Sell, 102, 40);\nbook.addLimit(4, Side::Buy,   99, 20);\nauto fills = book.addLimit(5, Side::Buy, 102, 100);\n// fills: {taker 5, maker 1, 101, 50}, {5, 2, 101, 30}, {5, 3, 102, 20}\n// bestBid() == 99, bestAsk() == 102, volumeAt(Sell, 102) == 20\nbook.cancel(3);   // true, the ask side is now empty\n```\n",
   "signature": "#include <cstdint>\n#include <optional>\n#include <vector>\n\nusing OrderId = std::uint64_t;\nusing Price = std::int64_t;   // integer ticks\nusing Qty = std::int64_t;\nenum class Side : std::uint8_t { Buy, Sell };\n\nstruct Fill {\n    OrderId taker;   // incoming order\n    OrderId maker;   // resting order\n    Price price;     // the maker's price\n    Qty qty;\n    bool operator==(const Fill&) const = default;\n};\n\nclass OrderBook {\n    // TODO: bid levels sorted best-first, ask levels sorted best-first,\n    //       each level a FIFO queue of resting orders\n    // TODO: order id -> where the order sits, so cancel needs no search\n\npublic:\n    std::vector<Fill> addLimit(OrderId id, Side side, Price price, Qty qty);\n    bool cancel(OrderId id);\n    std::optional<Price> bestBid() const;\n    std::optional<Price> bestAsk() const;\n    Qty volumeAt(Side side, Price price) const;\n    std::size_t orderCount() const;\n};\n",
   "hints": [
    "Bids: std::map<Price, Level, std::greater<Price>>, asks: std::map<Price, Level>. Then begin() is always the best price on each side. A Level is a std::list<Order> (FIFO) plus a running total quantity.",
    "For O(1) cancel keep std::unordered_map<OrderId, Locator> where Locator = {side, price, std::list<Order>::iterator}. list iterators stay valid when other elements are inserted or erased.",
    "Matching loop for a buy: while remaining > 0 and the best ask <= limit, trade with the FRONT order of that level at the maker's price, pop it when filled, erase the level when empty. Rest whatever is left at the back of its level."
   ],
   "checks": [
    {
     "label": "Price levels kept sorted (std::map / std::set)",
     "patterns": [
      "std::map\\s*<",
      "std::set\\s*<",
      "std::multimap"
     ]
    },
    {
     "label": "Bids sorted best-first (descending comparator or reverse iteration)",
     "patterns": [
      "std::greater",
      "rbegin",
      "prev\\s*\\(\\s*\\w+\\.end"
     ]
    },
    {
     "label": "FIFO queue per level for time priority",
     "patterns": [
      "std::list\\s*<",
      "std::deque\\s*<",
      "std::queue\\s*<"
     ]
    },
    {
     "label": "Hash map from order id for O(1) cancel",
     "patterns": [
      "std::unordered_map\\s*<"
     ]
    },
    {
     "label": "Stores an iterator to the order's position",
     "patterns": [
      "::iterator"
     ]
    },
    {
     "label": "Fills at the resting (maker) order's price",
     "patterns": [
      "maker",
      "resting",
      "passive"
     ]
    },
    {
     "label": "Removes empty price levels",
     "patterns": [
      "\\.erase\\s*\\(\\s*\\w+\\s*\\)[\\s\\S]*empty\\s*\\(|empty\\s*\\(\\s*\\)\\s*\\)\\s*\\w+\\.erase"
     ]
    },
    {
     "label": "Takes the minimum of remaining and resting quantity",
     "patterns": [
      "std::min",
      "<\\s*\\w+(\\.|->)qty\\s*\\?",
      "\\?\\s*\\w+\\s*:\\s*\\w+(\\.|->)qty"
     ]
    }
   ],
   "solution": "#include <cstdint>\n#include <functional>\n#include <list>\n#include <map>\n#include <optional>\n#include <stdexcept>\n#include <unordered_map>\n#include <vector>\n\nusing OrderId = std::uint64_t;\nusing Price = std::int64_t;    // integer ticks, never floating point\nusing Qty = std::int64_t;\n\nenum class Side : std::uint8_t { Buy, Sell };\n\nstruct Fill {\n    OrderId taker;   // the incoming (aggressive) order\n    OrderId maker;   // the resting (passive) order\n    Price price;     // always the maker's price\n    Qty qty;\n    bool operator==(const Fill&) const = default;\n};\n\nclass OrderBook {\n    struct Order { OrderId id; Qty qty; };\n    struct Level {\n        std::list<Order> fifo;   // time priority: front = oldest\n        Qty total = 0;           // aggregated quantity, kept in sync for O(1) depth queries\n    };\n    struct Locator {             // everything cancel() needs, with no search\n        Side side;\n        Price price;\n        std::list<Order>::iterator it;\n    };\n\n    std::map<Price, Level, std::greater<Price>> bids_;   // begin() = best (highest) bid\n    std::map<Price, Level, std::less<Price>> asks_;      // begin() = best (lowest) ask\n    std::unordered_map<OrderId, Locator> index_;\n\n    // Match an aggressive order against the opposite side. `crosses(levelPrice)` says\n    // whether the incoming limit price can trade at that level.\n    template <typename Book, typename Crosses>\n    void match(Book& book, OrderId taker, Qty& remaining, Crosses crosses, std::vector<Fill>& fills) {\n        while (remaining > 0 && !book.empty()) {\n            auto lvl = book.begin();                       // best price first\n            if (!crosses(lvl->first)) break;\n            Level& level = lvl->second;\n            while (remaining > 0 && !level.fifo.empty()) {\n                Order& maker = level.fifo.front();         // oldest order at this price\n                const Qty q = remaining < maker.qty ? remaining : maker.qty;\n                fills.push_back(Fill{taker, maker.id, lvl->first, q});\n                remaining -= q;\n                maker.qty -= q;\n                level.total -= q;\n                if (maker.qty == 0) {                      // fully filled: drop it everywhere\n                    index_.erase(maker.id);\n                    level.fifo.pop_front();\n                }                                          // partially filled keeps its place\n            }\n            if (level.fifo.empty()) book.erase(lvl);       // never leave empty levels behind\n        }\n    }\n\n    template <typename Book>\n    void rest(Book& book, Side side, OrderId id, Price price, Qty qty) {\n        Level& level = book[price];                        // O(log L), creates the level if new\n        level.fifo.push_back(Order{id, qty});              // back of the queue = newest\n        level.total += qty;\n        index_.emplace(id, Locator{side, price, std::prev(level.fifo.end())});\n    }\n\n    template <typename Book>\n    static Qty depth(const Book& book, Price price) {\n        auto it = book.find(price);\n        return it == book.end() ? 0 : it->second.total;\n    }\n\npublic:\n    // Match as much as possible, then rest the remainder. Returns the fills in execution order.\n    std::vector<Fill> addLimit(OrderId id, Side side, Price price, Qty qty) {\n        if (qty <= 0) throw std::invalid_argument(\"quantity must be positive\");\n        if (index_.count(id)) throw std::invalid_argument(\"duplicate order id\");\n        std::vector<Fill> fills;\n        Qty remaining = qty;\n        if (side == Side::Buy)\n            match(asks_, id, remaining, [price](Price ask) { return ask <= price; }, fills);\n        else\n            match(bids_, id, remaining, [price](Price bid) { return bid >= price; }, fills);\n        if (remaining > 0) {\n            if (side == Side::Buy) rest(bids_, side, id, price, remaining);\n            else rest(asks_, side, id, price, remaining);\n        }\n        return fills;\n    }\n\n    // O(1) to find the order, O(1) to unlink it from its level (O(log L) only if the level empties).\n    bool cancel(OrderId id) {\n        auto f = index_.find(id);\n        if (f == index_.end()) return false;\n        const Locator loc = f->second;\n        index_.erase(f);\n        auto unlink = [&](auto& book) {\n            auto lvl = book.find(loc.price);\n            lvl->second.total -= loc.it->qty;\n            lvl->second.fifo.erase(loc.it);               // list iterators stay valid elsewhere\n            if (lvl->second.fifo.empty()) book.erase(lvl);\n        };\n        if (loc.side == Side::Buy) unlink(bids_); else unlink(asks_);\n        return true;\n    }\n\n    std::optional<Price> bestBid() const {\n        if (bids_.empty()) return std::nullopt;\n        return bids_.begin()->first;\n    }\n    std::optional<Price> bestAsk() const {\n        if (asks_.empty()) return std::nullopt;\n        return asks_.begin()->first;\n    }\n    Qty volumeAt(Side side, Price price) const {\n        return side == Side::Buy ? depth(bids_, price) : depth(asks_, price);\n    }\n    std::size_t orderCount() const { return index_.size(); }\n    std::size_t levelCount(Side side) const { return side == Side::Buy ? bids_.size() : asks_.size(); }\n};\n",
   "tests": "#include <cassert>\n#include <iostream>\n#include <random>\n\nint main() {\n    {   // the statement's example\n        OrderBook book;\n        assert(book.addLimit(1, Side::Sell, 101, 50).empty());\n        assert(book.addLimit(2, Side::Sell, 101, 30).empty());   // same price, later in time\n        assert(book.addLimit(3, Side::Sell, 102, 40).empty());\n        assert(book.addLimit(4, Side::Buy, 99, 20).empty());\n        assert(*book.bestBid() == 99 && *book.bestAsk() == 101);\n        auto fills = book.addLimit(5, Side::Buy, 102, 100);        // sweeps 101 then part of 102\n        std::vector<Fill> expect{{5, 1, 101, 50}, {5, 2, 101, 30}, {5, 3, 102, 20}};\n        assert(fills == expect);\n        assert(*book.bestAsk() == 102 && book.volumeAt(Side::Sell, 102) == 20);\n        assert(*book.bestBid() == 99);                               // order 5 fully filled, did not rest\n        assert(book.cancel(3) && !book.bestAsk());\n        assert(!book.cancel(3));                                     // already gone\n    }\n    {   // partial fill keeps time priority; remainder rests at its limit\n        OrderBook book;\n        book.addLimit(10, Side::Buy, 100, 10);\n        book.addLimit(11, Side::Buy, 100, 10);\n        auto f1 = book.addLimit(12, Side::Sell, 100, 4);\n        assert(f1.size() == 1 && f1[0] == (Fill{12, 10, 100, 4}));\n        auto f2 = book.addLimit(13, Side::Sell, 100, 7);            // 6 from #10 then 1 from #11\n        assert(f2.size() == 2 && f2[0] == (Fill{13, 10, 100, 6}) && f2[1] == (Fill{13, 11, 100, 1}));\n        assert(book.volumeAt(Side::Buy, 100) == 9 && book.orderCount() == 1);\n        auto f3 = book.addLimit(14, Side::Sell, 99, 20);             // trades at 100 (maker price)\n        assert(f3.size() == 1 && f3[0] == (Fill{14, 11, 100, 9}));\n        assert(!book.bestBid() && *book.bestAsk() == 99 && book.volumeAt(Side::Sell, 99) == 11);\n    }\n    {   // cancel in the middle of a queue, then priority of the rest is unchanged\n        OrderBook book;\n        for (OrderId id = 1; id <= 5; ++id) book.addLimit(id, Side::Sell, 200, 1);\n        assert(book.cancel(3) && book.cancel(1));\n        auto f = book.addLimit(9, Side::Buy, 200, 3);\n        assert(f.size() == 3 && f[0].maker == 2 && f[1].maker == 4 && f[2].maker == 5);\n        assert(book.levelCount(Side::Sell) == 0 && book.orderCount() == 0);\n    }\n    {   // bad input\n        OrderBook book;\n        book.addLimit(1, Side::Buy, 10, 1);\n        bool threw = false;\n        try { book.addLimit(1, Side::Buy, 11, 1); } catch (const std::invalid_argument&) { threw = true; }\n        assert(threw);\n        threw = false;\n        try { book.addLimit(2, Side::Buy, 11, 0); } catch (const std::invalid_argument&) { threw = true; }\n        assert(threw);\n    }\n    {   // random stress: book never crossed, totals consistent with filled + resting quantity\n        OrderBook book;\n        std::mt19937 rng(42);\n        Qty inQty = 0, filledTwice = 0;\n        std::vector<std::pair<OrderId, Qty>> live;\n        for (OrderId id = 1; id <= 20000; ++id) {\n            if (id % 5 == 0 && !live.empty()) {\n                auto k = rng() % live.size();\n                OrderId victim = live[k].first;\n                live[k] = live.back(); live.pop_back();\n                (void)book.cancel(victim);\n            }\n            Side s = rng() % 2 ? Side::Buy : Side::Sell;\n            Price p = 1000 + static_cast<Price>(rng() % 21) - 10;\n            Qty q = 1 + static_cast<Qty>(rng() % 9);\n            inQty += q;\n            for (auto& f : book.addLimit(id, s, p, q)) { filledTwice += 2 * f.qty; assert(f.qty > 0); }\n            live.emplace_back(id, q);\n            if (book.bestBid() && book.bestAsk()) assert(*book.bestBid() < *book.bestAsk());\n        }\n        assert(filledTwice <= 2 * inQty);\n    }\n    std::cout << \"ALL TESTS PASSED\\n\";\n}\n",
   "explanation": "### Data structures\n| Need | Structure | Cost |\n|---|---|---|\n| Levels sorted by price | `std::map<Price, Level, std::greater<>>` bids, `std::map<Price, Level>` asks | best = `begin()`, O(1); insert level O(log L) |\n| Time priority inside a level | `std::list<Order>` (FIFO) | push_back / pop_front / erase(it) O(1) |\n| Cancel by id | `std::unordered_map<OrderId, {side, price, list::iterator}>` | O(1) average |\n| Depth at a price | `Level::total`, kept in sync on every change | O(log L) lookup |\n\n`std::list` is chosen because erasing one element never invalidates iterators to the others, so the iterators stored in the hash map stay valid. A `std::deque` or `std::vector` per level would invalidate them.\n\n### Matching\nFor a buy at limit `P`: while quantity remains and the best ask `<= P`, take the **front** order of the best ask level, trade `min(remaining, maker.qty)` at the **maker's** price, reduce both, pop the maker if it is filled (and erase it from the index), and erase the level when its queue is empty. A sell mirrors this against bids with `>=`. Whatever is left rests at the back of its own level's queue. Using one templated `match()` for both sides avoids copy-paste bugs.\n\nTrading at the maker's price is what gives the aggressor price improvement: a buy at 102 sweeping a 101 ask pays 101.\n\n### Complexity\n- `addLimit`: O(log L + F) where F is the number of fills (each fill removes or reduces one resting order).\n- `cancel`: O(1) average, plus O(log L) when the level becomes empty (the `find` on the map; storing a map iterator in the locator would make that O(1) too, as map iterators are stable).\n- `bestBid`/`bestAsk`: O(1).\n\n### Why this is not yet \"HFT fast\", and what interviewers ask next\n- `std::map` and `std::list` allocate a node per level and per order, and chase pointers across memory: poor cache behaviour. Production books use a **memory pool** for order nodes (problem 1), an **intrusive** doubly linked list, and often a **price-indexed array** of levels (the next problem).\n- `std::unordered_map` rehashing causes latency spikes: reserve up front, or use an open-addressing map keyed by order id.\n- Never use `double` for prices (0.1 + 0.2 != 0.3); store integer ticks.\n- Approaches from class compared: a priority queue with lazy deletion gives O(log n) add but cancel can only mark orders dead, so the heap fills with garbage; a `std::multiset` supports delete-in-the-middle but has no per-level FIFO or cheap depth. `map<price, FIFO>` plus an id index is the standard answer.\n- Follow-on features: modify (reduce quantity keeps priority, a price change loses it), market and IOC orders, self-trade prevention, and the BBO/market-data updates you would publish after each event.\n",
   "followUps": [
    "Add modify(id, newQty, newPrice): a quantity reduction keeps time priority, a price change or increase loses it. Why do exchanges use that rule?",
    "Replace std::list<Order> with an intrusive list whose nodes come from a MemoryPool<Order, N>. What allocations remain on the hot path?",
    "Support IOC (immediate-or-cancel) and market orders. Which code path changes?",
    "Store map iterators in the Locator to make cancel strictly O(1). Why are std::map iterators safe to keep?",
    "Publish a market-data update (level price, new total) after every add, fill and cancel. How do you batch them per incoming message?"
   ]
  },
  {
   "id": "price-level-book",
   "title": "Cache-Friendly Price-Level Array Book",
   "origin": "practice",
   "difficulty": "Medium",
   "topics": [
    "order book",
    "cache locality",
    "bit manipulation",
    "data-oriented design",
    "capstone"
   ],
   "sessions": [
    12,
    14
   ],
   "statement": "### Problem Description\nImplement `LevelBook<Levels>`, a **cache-friendly price-level book** for a market-data feed handler. Exchanges publish market-by-price updates of the form \"the total quantity at price P on side S is now Q\" (Q = 0 deletes the level). A `std::map` per side allocates a node for every new level and chases pointers on every lookup. Because prices move in fixed ticks and almost all activity happens within a narrow band around the current price, a trading system can instead index a flat array directly by `price - base`: every update is one array write, the data for neighbouring levels sits in the same cache lines, and nothing is ever allocated.\n\nThe book should:\n- store one contiguous array of quantities per side, where level `i` holds price `base + i`\n- apply `update(side, price, qty)` in O(1), returning `false` for prices outside `[base, base + Levels)`\n- track the index of the best bid (highest non-empty bid) and best ask (lowest non-empty ask)\n- when the best level is deleted, find the next best level by scanning **towards worse prices** only\n- for full marks, keep a bitmap of non-empty levels so the scan skips 64 empty levels at a time with `std::countl_zero` / `std::countr_zero`\n\n### Function Signature\n```cpp\ntemplate <std::size_t Levels>\nclass LevelBook {\npublic:\n    explicit LevelBook(Price base);\n    bool update(Side side, Price price, Qty qty);\n    std::optional<Price> bestBid() const;\n    std::optional<Price> bestAsk() const;\n    std::optional<Price> spread() const;\n    Qty qtyAt(Side side, Price price) const;\n};\n```\n\n### Constraints\n- `Levels` is a compile-time multiple of 64; prices are integer ticks\n- no heap allocation, ever: all storage is inside the object\n- `update`, `qtyAt`, `bestBid`, `bestAsk` and `spread` are O(1), except that deleting the current best level costs at most O(Levels / 64) word scans with a bitmap (O(Levels) without one)\n- empty sides return `std::nullopt`\n- the results must match a `std::map`-based reference implementation for any sequence of updates\n\n### Example\n```cpp\nLevelBook<1024> book(10000);          // covers prices 10000 .. 11023\nbook.update(Side::Buy,  10100, 500);\nbook.update(Side::Buy,  10098, 300);\nbook.update(Side::Sell, 10102, 200);\n// bestBid() == 10100, bestAsk() == 10102, spread() == 2\nbook.update(Side::Buy, 10100, 0);     // best bid level deleted\n// bestBid() == 10098\nbook.update(Side::Buy, 9999, 1);      // returns false: outside the band\n```\n",
   "signature": "#include <array>\n#include <cstddef>\n#include <cstdint>\n#include <optional>\n\nusing Price = std::int64_t;\nusing Qty = std::int64_t;\nenum class Side : std::uint8_t { Buy, Sell };\n\ntemplate <std::size_t Levels>\nclass LevelBook {\n    // TODO: one flat array of quantities per side, indexed by distance from the base price\n    // TODO: the index of the best bid and best ask level\n\npublic:\n    explicit LevelBook(Price base);\n    bool inRange(Price p) const;\n    bool update(Side side, Price price, Qty qty);   // qty 0 deletes the level; false if out of range\n    std::optional<Price> bestBid() const;\n    std::optional<Price> bestAsk() const;\n    std::optional<Price> spread() const;\n    Qty qtyAt(Side side, Price price) const;\n};\n",
   "hints": [
    "Level i holds price base + i. Keep std::array<Qty, Levels> per side and store the best bid and best ask as INDICES (use -1 and Levels to mean 'empty side').",
    "Adding quantity can only improve the best price: compare and update the index in O(1). Deleting the best level is the only expensive case: scan towards worse prices (down for bids, up for asks) until a non-empty level is found.",
    "Speed the scan up with a bitmap of non-empty levels (std::array<uint64_t, Levels / 64>). Mask the current word and use std::countl_zero / std::countr_zero from <bit> to jump to the next set bit. Watch the shift by 64 at bit 63."
   ],
   "checks": [
    {
     "label": "Flat array of levels (no tree, no heap)",
     "patterns": [
      "std::array\\s*<",
      "\\[\\s*Levels\\s*\\]"
     ]
    },
    {
     "label": "Indexes by price minus base",
     "patterns": [
      "price\\s*-\\s*\\w*base",
      "p\\s*-\\s*\\w*base"
     ]
    },
    {
     "label": "Updates a stored best bid / best ask index",
     "patterns": [
      "best\\w*\\s*=[^=]"
     ]
    },
    {
     "label": "Rejects prices outside the band",
     "patterns": [
      "return\\s+false",
      ">=\\s*\\w*base",
      "<\\s*\\w*base"
     ]
    },
    {
     "label": "Rescans when the best level is deleted",
     "patterns": [
      "while\\s*\\(",
      "for\\s*\\(",
      "countl_zero|countr_zero|__builtin_c[lt]z"
     ]
    },
    {
     "label": "Returns std::optional for an empty side",
     "patterns": [
      "nullopt"
     ]
    }
   ],
   "solution": "#include <array>\n#include <bit>\n#include <cstddef>\n#include <cstdint>\n#include <optional>\n\nusing Price = std::int64_t;   // integer ticks\nusing Qty = std::int64_t;\nenum class Side : std::uint8_t { Buy, Sell };\n\n// Market-by-price book over a fixed band of `Levels` ticks starting at `base`.\n// Level i <-> price base + i. Everything is a flat array: no allocation, no pointers to chase.\ntemplate <std::size_t Levels>\nclass LevelBook {\n    static_assert(Levels >= 64 && Levels % 64 == 0, \"Levels must be a multiple of 64\");\n    static constexpr std::size_t kWords = Levels / 64;\n    static constexpr std::int64_t kNoBid = -1;\n    static constexpr std::int64_t kNoAsk = static_cast<std::int64_t>(Levels);\n\n    struct SideBook {\n        std::array<Qty, Levels> qty{};             // quantity per tick, contiguous\n        std::array<std::uint64_t, kWords> mask{};  // bit i set <=> qty[i] > 0\n        void set(std::size_t i, Qty q) noexcept {\n            qty[i] = q;\n            const std::uint64_t bit = std::uint64_t{1} << (i % 64);\n            if (q > 0) mask[i / 64] |= bit; else mask[i / 64] &= ~bit;\n        }\n    };\n\n    Price base_;\n    SideBook bids_, asks_;\n    std::int64_t bestBid_ = kNoBid;   // index of highest non-empty bid level\n    std::int64_t bestAsk_ = kNoAsk;   // index of lowest non-empty ask level\n\n    // Highest set bit at index <= from, or kNoBid. Skips 64 empty levels per step.\n    std::int64_t highestAtOrBelow(const SideBook& s, std::int64_t from) const noexcept {\n        if (from < 0) return kNoBid;\n        std::int64_t w = from / 64;\n        const unsigned off = static_cast<unsigned>(from % 64);\n        std::uint64_t word = s.mask[w] & (off == 63 ? ~std::uint64_t{0} : ((std::uint64_t{1} << (off + 1)) - 1));\n        while (true) {\n            if (word) return w * 64 + 63 - std::countl_zero(word);\n            if (--w < 0) return kNoBid;\n            word = s.mask[w];\n        }\n    }\n    // Lowest set bit at index >= from, or kNoAsk.\n    std::int64_t lowestAtOrAbove(const SideBook& s, std::int64_t from) const noexcept {\n        if (from >= kNoAsk) return kNoAsk;\n        std::size_t w = static_cast<std::size_t>(from / 64);\n        std::uint64_t word = s.mask[w] & (~std::uint64_t{0} << (from % 64));\n        while (true) {\n            if (word) return static_cast<std::int64_t>(w * 64) + std::countr_zero(word);\n            if (++w == kWords) return kNoAsk;\n            word = s.mask[w];\n        }\n    }\n\npublic:\n    explicit LevelBook(Price base) noexcept : base_(base) {}\n\n    bool inRange(Price p) const noexcept { return p >= base_ && p < base_ + static_cast<Price>(Levels); }\n\n    // Apply a market-by-price update: the level's total quantity becomes `qty` (0 deletes it).\n    // O(1) except when the best level is deleted: then O(Levels / 64) word scans at worst.\n    bool update(Side side, Price price, Qty qty) noexcept {\n        if (!inRange(price) || qty < 0) return false;\n        const auto i = static_cast<std::int64_t>(price - base_);\n        if (side == Side::Buy) {\n            bids_.set(static_cast<std::size_t>(i), qty);\n            if (qty > 0) { if (i > bestBid_) bestBid_ = i; }\n            else if (i == bestBid_) bestBid_ = highestAtOrBelow(bids_, i - 1);\n        } else {\n            asks_.set(static_cast<std::size_t>(i), qty);\n            if (qty > 0) { if (i < bestAsk_) bestAsk_ = i; }\n            else if (i == bestAsk_) bestAsk_ = lowestAtOrAbove(asks_, i + 1);\n        }\n        return true;\n    }\n\n    std::optional<Price> bestBid() const noexcept {\n        if (bestBid_ == kNoBid) return std::nullopt;\n        return base_ + bestBid_;\n    }\n    std::optional<Price> bestAsk() const noexcept {\n        if (bestAsk_ == kNoAsk) return std::nullopt;\n        return base_ + bestAsk_;\n    }\n    std::optional<Price> spread() const noexcept {\n        if (bestBid_ == kNoBid || bestAsk_ == kNoAsk) return std::nullopt;\n        return bestAsk_ - bestBid_;\n    }\n    Qty qtyAt(Side side, Price price) const noexcept {\n        if (!inRange(price)) return 0;\n        const auto i = static_cast<std::size_t>(price - base_);\n        return side == Side::Buy ? bids_.qty[i] : asks_.qty[i];\n    }\n    // Total bid quantity in the best n non-empty levels (e.g. for a depth-weighted signal).\n    Qty bidDepth(int n) const noexcept {\n        Qty total = 0;\n        for (std::int64_t i = bestBid_; i != kNoBid && n > 0; i = highestAtOrBelow(bids_, i - 1), --n)\n            total += bids_.qty[static_cast<std::size_t>(i)];\n        return total;\n    }\n};\n",
   "tests": "#include <cassert>\n#include <iostream>\n#include <map>\n#include <random>\n\nint main() {\n    {   // the statement's example\n        LevelBook<1024> book(10000);\n        assert(!book.bestBid() && !book.bestAsk() && !book.spread());\n        book.update(Side::Buy, 10100, 500);\n        book.update(Side::Buy, 10098, 300);\n        book.update(Side::Sell, 10102, 200);\n        book.update(Side::Sell, 10105, 700);\n        assert(*book.bestBid() == 10100 && *book.bestAsk() == 10102 && *book.spread() == 2);\n        book.update(Side::Buy, 10100, 0);            // best bid deleted: fall back to 10098\n        assert(*book.bestBid() == 10098);\n        book.update(Side::Sell, 10102, 0);\n        assert(*book.bestAsk() == 10105 && book.qtyAt(Side::Sell, 10105) == 700);\n        assert(!book.update(Side::Buy, 9999, 1));    // outside the band\n        assert(!book.update(Side::Buy, 10000 + 1024, 1));\n        assert(book.update(Side::Buy, 10000, 1) && book.update(Side::Sell, 10000 + 1023, 1));\n        assert(book.bidDepth(2) == 301);\n    }\n    {   // scanning across 64-level word boundaries in both directions\n        LevelBook<256> book(0);\n        book.update(Side::Buy, 3, 1);\n        book.update(Side::Buy, 200, 1);\n        book.update(Side::Buy, 200, 0);\n        assert(*book.bestBid() == 3);\n        book.update(Side::Buy, 3, 0);\n        assert(!book.bestBid());\n        book.update(Side::Sell, 255, 4);\n        book.update(Side::Sell, 63, 1);\n        book.update(Side::Sell, 64, 2);\n        book.update(Side::Sell, 63, 0);\n        assert(*book.bestAsk() == 64);\n        book.update(Side::Sell, 64, 0);\n        assert(*book.bestAsk() == 255);\n    }\n    {   // random differential test against a std::map reference\n        LevelBook<512> book(1000);\n        std::map<Price, Qty> bids, asks;\n        std::mt19937 rng(7);\n        for (int step = 0; step < 200000; ++step) {\n            Side s = rng() % 2 ? Side::Buy : Side::Sell;\n            Price p = 1000 + static_cast<Price>(rng() % 512);\n            Qty q = rng() % 3 == 0 ? 0 : 1 + static_cast<Qty>(rng() % 100);\n            assert(book.update(s, p, q));\n            auto& ref = s == Side::Buy ? bids : asks;\n            if (q == 0) ref.erase(p); else ref[p] = q;\n            if (bids.empty()) assert(!book.bestBid()); else assert(*book.bestBid() == bids.rbegin()->first);\n            if (asks.empty()) assert(!book.bestAsk()); else assert(*book.bestAsk() == asks.begin()->first);\n            assert(book.qtyAt(s, p) == q);\n        }\n    }\n    std::cout << \"ALL TESTS PASSED\\n\";\n}\n",
   "explanation": "### How it works\nEach side is `std::array<Qty, Levels>` plus a bitmap `std::array<uint64_t, Levels / 64>` where bit `i` says \"level `i` is non-empty\". The book stores the **index** of the best bid and best ask.\n- **Update with qty > 0:** write the quantity, set the bit, and improve the best index if this level is better (`i > bestBid` for bids, `i < bestAsk` for asks). O(1).\n- **Update with qty == 0:** write 0, clear the bit. If this was the best level, scan for the next one **in the worse direction only** (down for bids, up for asks). With the bitmap the scan masks the current word, then uses `std::countl_zero` (bids: highest set bit) or `std::countr_zero` (asks: lowest set bit), skipping 64 empty levels per instruction. Those compile to single `lzcnt`/`tzcnt` (x86) or `clz`/`rbit+clz` (ARM) instructions.\n- **Queries:** `bestBid/bestAsk/spread` read one integer; `qtyAt` is a single array index.\n\n### Why it beats `std::map` on the hot path\n- No allocation at all; the whole book for 1024 levels is ~16 KB for quantities plus 256 bytes of bitmap and stays warm in L1/L2.\n- Neighbouring levels are adjacent in memory, so \"top 5 levels\" touches one or two cache lines instead of five tree nodes scattered across the heap.\n- Branches are predictable and there is no pointer chasing, which is exactly the \"data-oriented\" design taught for low-latency code.\n\n### Trade-offs and pitfalls\n- **The band is fixed.** Prices outside `[base, base + Levels)` are rejected. Real systems re-centre (\"recenter/shift\") the array when the price drifts, or keep a fallback map for far-away levels.\n- **Memory grows with the band, not with the number of orders.** A very wide band with few levels wastes memory and makes worst-case scans longer, which the bitmap mitigates.\n- Off-by-one errors at word boundaries (bit 63, bit 0) are the classic bug: the solution builds the \"bits at or below `off`\" mask specially for `off == 63`, because `1ull << 64` is undefined behaviour.\n- Use integer ticks: `(price - base)` must be an exact integer index.\n- This is a market-by-price book (aggregated quantity per level). For a market-by-order book, each level would also own a FIFO of order nodes from a memory pool, as in the previous problem.\n\n### What an interviewer probes\nWhy arrays beat trees here (cache lines, prefetching, no allocation); the cost of deleting the best level and how a bitmap or a two-level summary bitmap reduces it; what happens when the market gaps outside the band; how you would keep the best index correct if updates arrive out of order.\n",
   "followUps": [
    "Add a two-level bitmap (one summary bit per 64-bit word) so finding the next level is O(1) even for a 65,536-level band.",
    "Implement re-centring: when a price arrives outside the band, shift the window. What does it cost and how do you avoid doing it on every tick?",
    "Turn it into a market-by-order book: each level owns an intrusive FIFO of orders from a MemoryPool. What extra state does cancel need?",
    "Lay out bid and ask arrays so the top 8 levels of both sides fit in as few cache lines as possible. Would struct-of-arrays or array-of-structs be better?",
    "Measure it: a std::map<Price, Qty> versus this array for 10 million random updates near the touch. Which hardware counters explain the difference?"
   ]
  },
  {
   "id": "constexpr-crtp",
   "title": "Compile-Time Tables and CRTP Dispatch",
   "origin": "practice",
   "difficulty": "Medium",
   "topics": [
    "constexpr",
    "consteval",
    "lookup tables",
    "CRTP",
    "static polymorphism",
    "bit manipulation",
    "templates"
   ],
   "sessions": [
    5,
    11
   ],
   "statement": "### Problem Description\nMove work from run time to compile time, and replace virtual dispatch with static dispatch. This problem has two parts that together model a market-data feed handler.\n\n**Part A, compile-time tables.** Checksums and bit counts appear everywhere in a feed handler (validating packets, counting set bits in a level bitmap). A lookup table makes them fast, but filling it at start-up wastes time and filling it lazily puts a branch on the hot path. With `consteval`/`constexpr` the compiler computes the table, stores it in read-only data, and `static_assert` can prove the code is correct before it ever runs.\n\n**Part B, CRTP.** A generic `FeedHandler` parses and validates packets and then calls handler code that each strategy supplies. With a virtual `onAdd` every message costs an indirect call that cannot be inlined. The Curiously Recurring Template Pattern (`class MyHandler : public FeedHandler<MyHandler>`) lets the base class call `static_cast<Derived&>(*this).onAdd(...)`, which the compiler resolves and inlines at compile time.\n\nImplement:\n- `consteval makeCrcTable()` returning the 256-entry CRC-32 table (reflected polynomial `0xEDB88320`), stored in an `inline constexpr` variable\n- `constexpr crc32(std::string_view)` using that table, usable inside `static_assert`\n- `constexpr popcount64(std::uint64_t)` using a compile-time 256-entry byte table\n- `FeedHandler<Derived>::handle(packet)`: check the length, check the CRC trailer, then dispatch `'A'` to `onAdd` and `'X'` to `onCancel` on the derived class; route invalid packets to `onBadPacket`, which has a default in the base that the derived class can replace\n\n### Function Signature\n```cpp\nconsteval std::array<std::uint32_t, 256> makeCrcTable();\nconstexpr std::uint32_t crc32(std::string_view data);\nconstexpr int popcount64(std::uint64_t x);\n\ntemplate <typename Derived>\nclass FeedHandler {\npublic:\n    bool handle(std::string_view packet);\n    std::uint64_t goodPackets() const;\n    std::uint64_t badPackets() const;\n};\n```\n\n### Constraints\n- `static_assert(crc32(\"123456789\") == 0xCBF43926)` must compile (the standard CRC-32 check value)\n- the tables are computed entirely at compile time (no start-up initialisation code)\n- `FeedHandler` has no virtual functions: `std::is_polymorphic_v<MyHandler>` is `false`\n- the base class must not be constructible or deletable on its own (protected constructor and destructor)\n- `handle` is O(packet length) and never allocates\n\n### Example\n```cpp\nstatic_assert(crc32(\"123456789\") == 0xCBF43926u);\nstatic_assert(popcount64(0xF0F0) == 8);\n\nstruct MyHandler : FeedHandler<MyHandler> {\n    void onAdd(std::string_view p)    { /* new order */ }\n    void onCancel(std::string_view p) { /* cancel  */ }\n};\nMyHandler h;\nh.handle(frame(\"AAAPL:100@19050\"));   // true, calls MyHandler::onAdd(\"AAPL:100@19050\")\nh.handle(corruptedPacket);            // false, CRC mismatch\n// output: goodPackets() == 1, badPackets() == 1\n```\n",
   "signature": "#include <array>\n#include <cstddef>\n#include <cstdint>\n#include <string_view>\n\n// Part A: build these tables at COMPILE time.\nconsteval std::array<std::uint32_t, 256> makeCrcTable();   // CRC-32, polynomial 0xEDB88320\nconstexpr std::uint32_t crc32(std::string_view data);       // must be usable in static_assert\nconstexpr int popcount64(std::uint64_t x);                  // via a 256-entry byte table\n\n// Part B: static polymorphism. Packet = [type][payload][4-byte little-endian CRC-32].\ntemplate <typename Derived>\nclass FeedHandler {\npublic:\n    // Validate the CRC, then dispatch 'A' to Derived::onAdd(payload) and 'X' to\n    // Derived::onCancel(payload) WITHOUT virtual functions. Anything invalid goes to\n    // onBadPacket (Derived may provide one; otherwise a default that does nothing).\n    bool handle(std::string_view packet);\n    std::uint64_t goodPackets() const;\n    std::uint64_t badPackets() const;\n};\n",
   "hints": [
    "Write makeCrcTable() as an ordinary loop that fills a std::array and returns it; mark it consteval and store the result in `inline constexpr auto kCrcTable = makeCrcTable();`. Then crc32 can be constexpr and checked with static_assert.",
    "CRC-32 per byte: c = table[(c ^ byte) & 0xFF] ^ (c >> 8), start with 0xFFFFFFFF and xor with 0xFFFFFFFF at the end. Each table entry is i shifted right 8 times, xoring 0xEDB88320 whenever the low bit was 1.",
    "CRTP: `template <class Derived> class FeedHandler`, a helper `Derived& self() { return static_cast<Derived&>(*this); }`, and calls like self().onAdd(payload). Give the base a do-nothing onBadPacket and make its constructor and destructor protected."
   ],
   "checks": [
    {
     "label": "Table filled by a loop that runs at compile time (consteval / constexpr function)",
     "patterns": [
      "(consteval|constexpr)[^;{]*\\{[\\s\\S]*for\\s*\\("
     ]
    },
    {
     "label": "Table stored as a constexpr variable",
     "patterns": [
      "(inline\\s+)?constexpr\\s+(auto|std::array\\s*<[^>]*>)\\s+\\w+\\s*=\\s*\\w+\\s*\\("
     ]
    },
    {
     "label": "Uses the CRC-32 polynomial",
     "patterns": [
      "0xEDB88320"
     ]
    },
    {
     "label": "Verified with static_assert",
     "patterns": [
      "static_assert"
     ]
    },
    {
     "label": "Byte-wise popcount table or recurrence",
     "patterns": [
      "\\[\\s*i\\s*(/\\s*2|>>\\s*1)\\s*\\]",
      ">>=\\s*8",
      "std::popcount",
      "__builtin_popcount"
     ]
    },
    {
     "label": "CRTP: static_cast to the derived type",
     "patterns": [
      "static_cast\\s*<\\s*(const\\s+)?Derived\\s*[&*]"
     ]
    },
    {
     "label": "Base class dispatches to the derived class's onAdd / onCancel",
     "patterns": [
      "\\)\\s*\\.\\s*onAdd\\s*\\(",
      "->\\s*onAdd\\s*\\(",
      "self\\s*\\(\\s*\\)\\s*\\.\\s*on"
     ]
    }
   ],
   "solution": "#include <array>\n#include <bit>\n#include <cstddef>\n#include <cstdint>\n#include <string_view>\n\n// ---------- Part A: tables computed by the compiler ----------\n\n// CRC-32 (IEEE 802.3, reflected polynomial 0xEDB88320), table-driven.\nconsteval std::array<std::uint32_t, 256> makeCrcTable() {\n    std::array<std::uint32_t, 256> t{};\n    for (std::uint32_t i = 0; i < 256; ++i) {\n        std::uint32_t c = i;\n        for (int k = 0; k < 8; ++k) c = (c & 1u) ? (0xEDB88320u ^ (c >> 1)) : (c >> 1);\n        t[i] = c;\n    }\n    return t;\n}\ninline constexpr std::array<std::uint32_t, 256> kCrcTable = makeCrcTable();   // lives in .rodata\n\nconstexpr std::uint32_t crc32(std::string_view data) noexcept {\n    std::uint32_t c = 0xFFFFFFFFu;\n    for (char ch : data) c = kCrcTable[(c ^ static_cast<std::uint8_t>(ch)) & 0xFFu] ^ (c >> 8);\n    return c ^ 0xFFFFFFFFu;\n}\nstatic_assert(crc32(\"123456789\") == 0xCBF43926u, \"standard CRC-32 check value\");\nstatic_assert(crc32(\"\") == 0u);\n\n// Bit-count table: popcount of every byte, used 8 bytes at a time.\nconsteval std::array<std::uint8_t, 256> makePopTable() {\n    std::array<std::uint8_t, 256> t{};\n    for (int i = 1; i < 256; ++i) t[i] = static_cast<std::uint8_t>((i & 1) + t[i / 2]);\n    return t;\n}\ninline constexpr auto kPopTable = makePopTable();\n\nconstexpr int popcount64(std::uint64_t x) noexcept {\n    int n = 0;\n    for (int b = 0; b < 8; ++b, x >>= 8) n += kPopTable[x & 0xFFu];\n    return n;\n}\nstatic_assert(popcount64(0) == 0 && popcount64(~0ull) == 64 && popcount64(0xF0F0ull) == 8);\n\n// ---------- Part B: static polymorphism with CRTP ----------\n//\n// Packet format: [type byte][payload ...][4-byte little-endian CRC-32 of type+payload]\n// 'A' = add order, 'X' = cancel order. The base class owns the parsing and validation;\n// the derived class supplies the reactions. No virtual functions, so calls inline.\ntemplate <typename Derived>\nclass FeedHandler {\n    std::uint64_t good_ = 0, bad_ = 0;\n\n    Derived& self() noexcept { return static_cast<Derived&>(*this); }\n\nprotected:\n    FeedHandler() = default;           // only a derived class can create one\n    ~FeedHandler() = default;          // non-virtual, protected: no delete through Base*\n\n    // Default hook; Derived may \"override\" it by declaring its own onBadPacket.\n    void onBadPacket(std::string_view) noexcept {}\n\npublic:\n    bool handle(std::string_view packet) {\n        if (packet.size() < 5) { ++bad_; self().onBadPacket(packet); return false; }\n        const std::string_view body = packet.substr(0, packet.size() - 4);\n        std::uint32_t wire = 0;\n        for (int i = 0; i < 4; ++i)\n            wire |= static_cast<std::uint32_t>(static_cast<std::uint8_t>(packet[packet.size() - 4 + i])) << (8 * i);\n        if (wire != crc32(body)) { ++bad_; self().onBadPacket(packet); return false; }\n        const std::string_view payload = body.substr(1);\n        switch (body[0]) {\n            case 'A': self().onAdd(payload); break;      // resolved at compile time\n            case 'X': self().onCancel(payload); break;\n            default: ++bad_; self().onBadPacket(packet); return false;\n        }\n        ++good_;\n        return true;\n    }\n    std::uint64_t goodPackets() const noexcept { return good_; }\n    std::uint64_t badPackets() const noexcept { return bad_; }\n};\n",
   "tests": "#include <cassert>\n#include <iostream>\n#include <string>\n#include <type_traits>\n\nstd::string frame(std::string body) {\n    const std::uint32_t c = crc32(body);\n    for (int i = 0; i < 4; ++i) body.push_back(static_cast<char>((c >> (8 * i)) & 0xFFu));\n    return body;\n}\n\nstruct CountingHandler : FeedHandler<CountingHandler> {\n    int adds = 0, cancels = 0, rejects = 0;\n    std::string lastAdd;\n    void onAdd(std::string_view p) { ++adds; lastAdd = std::string(p); }\n    void onCancel(std::string_view) { ++cancels; }\n    void onBadPacket(std::string_view) { ++rejects; }   // hides the base default\n};\nstruct QuietHandler : FeedHandler<QuietHandler> {     // uses the default onBadPacket\n    int adds = 0;\n    void onAdd(std::string_view) { ++adds; }\n    void onCancel(std::string_view) {}\n};\n\nint main() {\n    // Part A: everything below is checked by the compiler, at compile time.\n    static_assert(kCrcTable[1] == 0x77073096u && kCrcTable[255] == 0x2D02EF8Du);\n    constexpr std::uint32_t c = crc32(\"The quick brown fox jumps over the lazy dog\");\n    static_assert(c == 0x414FA339u);\n    for (std::uint64_t x : {0ull, 1ull, 0xDEADBEEFull, 0x8000000000000001ull, ~0ull, 12345678901234ull})\n        assert(popcount64(x) == std::popcount(x));\n    // Part B\n    static_assert(!std::is_polymorphic_v<CountingHandler>, \"no vtable\");\n    static_assert(sizeof(QuietHandler) == 24, \"two counters + int + padding, no vptr\");\n    CountingHandler h;\n    assert(h.handle(frame(\"AAAPL:100@19050\")));\n    assert(h.handle(frame(\"X42\")));\n    std::string corrupted = frame(\"AIBM:5@100\");\n    corrupted[2] ^= 0x01;                                     // flip one bit\n    assert(!h.handle(corrupted));\n    assert(!h.handle(\"ab\"));                                  // too short\n    assert(!h.handle(frame(\"Zunknown\")));                     // unknown type\n    assert(h.adds == 1 && h.cancels == 1 && h.rejects == 3 && h.lastAdd == \"AAPL:100@19050\");\n    assert(h.goodPackets() == 2 && h.badPackets() == 3);\n    QuietHandler q;\n    assert(!q.handle(\"xx\") && q.handle(frame(\"A1\")) && q.adds == 1 && q.badPackets() == 1);\n    std::cout << \"ALL TESTS PASSED\\n\";\n}\n",
   "explanation": "### Part A: compile-time tables\n- `consteval` forces the function to run at compile time (calling it at run time is an error). `constexpr` *allows* compile-time evaluation and also works at run time.\n- `inline constexpr auto kCrcTable = makeCrcTable();` puts the 1 KB table in read-only data: zero start-up cost, no \"is it initialised yet?\" branch, and no static-initialisation-order problems across translation units (`inline` also gives one definition program-wide).\n- The CRC loop is the standard reflected byte-at-a-time algorithm: `c = table[(c ^ byte) & 0xFF] ^ (c >> 8)`, starting from `0xFFFFFFFF` and inverting at the end. Because `crc32` is `constexpr`, `static_assert(crc32(\"123456789\") == 0xCBF43926)` proves the implementation correct at build time. A wrong table simply fails to compile.\n- The popcount table uses the recurrence `pop[i] = (i & 1) + pop[i / 2]`. On real hardware `std::popcount` (C++20 `<bit>`) compiles to one `popcnt`/`cnt` instruction and beats the table; the table exercise is about how lookup tables are built, and it is the right answer for things the CPU has no instruction for (CRC without `crc32` instructions, parity of custom fields, character classes).\n\n### Part B: CRTP\n```cpp\ntemplate <class Derived> class FeedHandler {\n    Derived& self() { return static_cast<Derived&>(*this); }\npublic:\n    bool handle(std::string_view p) { ...; self().onAdd(payload); ... }\n};\nstruct MyHandler : FeedHandler<MyHandler> { void onAdd(std::string_view); ... };\n```\n- `static_cast<Derived&>(*this)` is safe because the base is only ever a base of `Derived` (that is what the template argument promises). The call target is known at compile time, so it can be inlined; there is no vtable pointer and no indirect branch.\n- **Default implementations:** the base declares `onBadPacket`; if the derived class declares its own, name lookup through `self()` finds the derived one first (static \"override\"). If it does not, the base version is used.\n- **Protected, non-virtual destructor and constructor:** nobody can create a bare `FeedHandler<X>` or delete a derived object through a base pointer (which would be UB without a virtual destructor).\n\n### Trade-offs to state in an exam\n| | virtual | CRTP |\n|---|---|---|\n| Dispatch | indirect call through vtable | direct call, inlinable |\n| Heterogeneous container | `std::vector<Base*>` works | each `FeedHandler<X>` is a different type |\n| Choice of behaviour | at run time | at compile time |\n| Code size | one copy | one instantiation per derived type |\nA forgotten `onCancel` in the derived class is a compile error (good). A typo such as `onCancle` is also an error at the call site, but a typo in an optional hook like `onBadPacket` silently uses the default. C++20 concepts or `static_assert(requires ...)` can make the contract explicit. C++23 \"deducing this\" (`this auto& self`) removes the need for the template parameter altogether.\n\n### Pitfalls\n- `static_assert` on a value that is not a constant expression (for example calling a non-`constexpr` helper inside `crc32`) fails to compile.\n- Signed `char`: convert each byte with `static_cast<std::uint8_t>` before indexing, or negative chars index the table out of bounds.\n- `1u << 32` and similar shifts are UB; keep shift counts below the width.\n",
   "followUps": [
    "Use SSE4.2 _mm_crc32_u64 or ARMv8 __crc32cd for CRC-32C. Why is that a different polynomial (Castagnoli) from the one here?",
    "Rewrite FeedHandler with C++23 deducing this (`bool handle(this auto& self, std::string_view)`). What disappears?",
    "Add a concept that checks at compile time that Derived provides onAdd and onCancel with the right signatures, with a readable error.",
    "Make the CRC slice-by-8 (eight 256-entry tables, 8 bytes per step). Generate all 8 tables at compile time.",
    "When is virtual dispatch actually fine on a hot path? (Devirtualisation with final, a well-predicted indirect branch.)"
   ]
  },
  {
   "id": "bounded-blocking-queue",
   "title": "Bounded Blocking Queue (Producer-Consumer)",
   "origin": "practice",
   "difficulty": "Medium",
   "topics": [
    "mutex",
    "condition variable",
    "producer-consumer",
    "back-pressure",
    "shutdown"
   ],
   "sessions": [
    9
   ],
   "statement": "### Problem Description\nImplement a thread-safe **bounded blocking queue** for many producers and many consumers, using `std::mutex` and `std::condition_variable`. Not every queue in a trading system is on the microsecond path: logging, persistence of fills, risk reports and drop-copy feeds run on background threads, and there a blocking queue is the right tool, because idle threads should sleep instead of burning a core, and the bound applies **back-pressure** so a slow consumer cannot make memory grow without limit. Knowing exactly why the lock-free SPSC queue is faster, and when this one is the better choice, is a standard exam question.\n\nThe queue should:\n- hold at most `capacity` elements in storage allocated once in the constructor\n- block producers in `push` while the queue is full and consumers in `pop` while it is empty\n- use two condition variables (not-full and not-empty) and always wait with a predicate, so spurious wake-ups are harmless\n- offer non-blocking `try_push` / `try_pop`\n- support `close()`: wake every waiting thread; afterwards `push` fails, while `pop` keeps returning the remaining elements and then returns `std::nullopt`\n- work with move-only element types\n\n### Function Signature\n```cpp\ntemplate <typename T>\nclass BoundedBlockingQueue {\npublic:\n    explicit BoundedBlockingQueue(std::size_t capacity);\n    template <typename U> bool push(U&& value);\n    std::optional<T> pop();\n    template <typename U> bool try_push(U&& value);\n    std::optional<T> try_pop();\n    void close();\n    std::size_t size() const;\n};\n```\n\n### Constraints\n- the constructor throws `std::invalid_argument` if `capacity == 0`\n- `push`/`pop` are O(1) apart from waiting; there is no allocation per element (use a ring buffer, not a `std::deque` that allocates blocks)\n- FIFO order; with many producers and consumers every pushed element is popped exactly once\n- no lost wake-ups and no deadlock on shutdown; clean under ThreadSanitizer\n\n### Example\n```cpp\nBoundedBlockingQueue<int> q(2);\nq.push(1);\nq.push(2);\n// a third q.push(3) would block here until a consumer pops\nq.try_push(3);    // false: full\nq.pop();          // 1\nq.close();\nq.push(4);        // false: closed\nq.pop();          // 2: remaining elements are still delivered\nq.pop();          // std::nullopt: closed and drained\n```\n",
   "signature": "#include <condition_variable>\n#include <cstddef>\n#include <mutex>\n#include <optional>\n\ntemplate <typename T>\nclass BoundedBlockingQueue {\n    // TODO: fixed-capacity storage allocated once in the constructor\n    // TODO: a lock, and a way for producers and consumers to sleep until they can proceed\n    // TODO: a shutdown flag\n\npublic:\n    explicit BoundedBlockingQueue(std::size_t capacity);\n\n    template <typename U>\n    bool push(U&& value);          // blocks while full; false if the queue is closed\n    std::optional<T> pop();        // blocks while empty; nullopt once closed AND drained\n\n    template <typename U>\n    bool try_push(U&& value);      // never blocks\n    std::optional<T> try_pop();    // never blocks\n\n    void close();                  // wake every waiting thread\n    std::size_t size() const;\n};\n",
   "hints": [
    "Protect a ring buffer (head, count) with one std::mutex. Use two std::condition_variable objects: producers wait on notFull, consumers wait on notEmpty.",
    "Always wait with a predicate: cv.wait(lock, [&]{ return count < capacity || closed; }). After changing the state, notify the OTHER condition variable.",
    "close() sets the flag under the lock and calls notify_all on both CVs. pop returns nullopt only when closed AND count == 0, so items pushed before close are still delivered."
   ],
   "checks": [
    {
     "label": "Uses a mutex",
     "patterns": [
      "std::mutex"
     ]
    },
    {
     "label": "Uses condition variables",
     "patterns": [
      "condition_variable\\s+\\w+"
     ]
    },
    {
     "label": "Waits with a predicate or a while loop",
     "patterns": [
      "\\.wait\\s*\\(\\s*\\w+\\s*,",
      "while\\s*\\([^)]*\\)\\s*\\w+\\.wait"
     ]
    },
    {
     "label": "Locks with unique_lock / lock_guard / scoped_lock",
     "patterns": [
      "unique_lock",
      "lock_guard",
      "scoped_lock"
     ]
    },
    {
     "label": "Notifies waiting threads",
     "patterns": [
      "notify_one",
      "notify_all"
     ]
    },
    {
     "label": "Supports shutdown (close flag + notify_all)",
     "patterns": [
      "notify_all"
     ]
    },
    {
     "label": "Fixed-capacity storage (ring index)",
     "patterns": [
      "%\\s*\\w*(cap|size|ring)",
      "capacity"
     ]
    }
   ],
   "solution": "#include <condition_variable>\n#include <stdexcept>\n#include <cstddef>\n#include <mutex>\n#include <optional>\n#include <utility>\n#include <vector>\n\n// Multi-producer / multi-consumer bounded queue with blocking push/pop and shutdown.\ntemplate <typename T>\nclass BoundedBlockingQueue {\n    std::vector<std::optional<T>> ring_;   // preallocated once: no allocation per element\n    std::size_t head_ = 0, count_ = 0;     // protected by m_\n    bool closed_ = false;\n    mutable std::mutex m_;\n    std::condition_variable notFull_;      // producers wait here\n    std::condition_variable notEmpty_;     // consumers wait here\n\npublic:\n    explicit BoundedBlockingQueue(std::size_t capacity) : ring_(capacity) {\n        if (capacity == 0) throw std::invalid_argument(\"capacity must be positive\");\n    }\n    BoundedBlockingQueue(const BoundedBlockingQueue&) = delete;\n    BoundedBlockingQueue& operator=(const BoundedBlockingQueue&) = delete;\n\n    // Blocks while full. Returns false (and drops nothing) if the queue was closed.\n    template <typename U>\n    bool push(U&& v) {\n        std::unique_lock lk(m_);\n        // The predicate form re-checks the condition after every wake-up, which handles\n        // spurious wake-ups and \"another producer got there first\".\n        notFull_.wait(lk, [&] { return count_ < ring_.size() || closed_; });\n        if (closed_) return false;\n        ring_[(head_ + count_) % ring_.size()].emplace(std::forward<U>(v));\n        ++count_;\n        lk.unlock();                 // notify after unlocking: the woken thread can take the lock at once\n        notEmpty_.notify_one();\n        return true;\n    }\n\n    // Blocks while empty. Returns std::nullopt only when closed AND drained.\n    std::optional<T> pop() {\n        std::unique_lock lk(m_);\n        notEmpty_.wait(lk, [&] { return count_ > 0 || closed_; });\n        if (count_ == 0) return std::nullopt;          // closed and nothing left\n        std::optional<T> out(std::move(*ring_[head_]));\n        ring_[head_].reset();\n        head_ = (head_ + 1) % ring_.size();\n        --count_;\n        lk.unlock();\n        notFull_.notify_one();\n        return out;\n    }\n\n    // Non-blocking variants for callers that must never sleep.\n    template <typename U>\n    bool try_push(U&& v) {\n        {\n            std::lock_guard lk(m_);\n            if (closed_ || count_ == ring_.size()) return false;\n            ring_[(head_ + count_) % ring_.size()].emplace(std::forward<U>(v));\n            ++count_;\n        }\n        notEmpty_.notify_one();\n        return true;\n    }\n    std::optional<T> try_pop() {\n        std::optional<T> out;\n        {\n            std::lock_guard lk(m_);\n            if (count_ == 0) return std::nullopt;\n            out.emplace(std::move(*ring_[head_]));\n            ring_[head_].reset();\n            head_ = (head_ + 1) % ring_.size();\n            --count_;\n        }\n        notFull_.notify_one();\n        return out;\n    }\n\n    // Wake everybody: producers fail from now on, consumers drain what is left and then stop.\n    void close() {\n        { std::lock_guard lk(m_); closed_ = true; }\n        notFull_.notify_all();\n        notEmpty_.notify_all();\n    }\n\n    std::size_t size() const { std::lock_guard lk(m_); return count_; }\n    std::size_t capacity() const noexcept { return ring_.size(); }\n};\n",
   "tests": "#include <atomic>\n#include <cassert>\n#include <chrono>\n#include <iostream>\n#include <memory>\n#include <stdexcept>\n#include <thread>\n#include <vector>\n\nint main() {\n    {   // single-threaded behaviour\n        BoundedBlockingQueue<int> q(2);\n        assert(q.try_push(1) && q.try_push(2) && !q.try_push(3));\n        assert(q.size() == 2 && *q.pop() == 1 && *q.try_pop() == 2 && !q.try_pop());\n        q.push(7);\n        q.close();\n        assert(!q.push(8) && !q.try_push(8));     // closed: producers fail\n        assert(*q.pop() == 7);                    // but consumers drain\n        assert(!q.pop());                         // then stop\n        bool threw = false;\n        try { BoundedBlockingQueue<int> bad(0); } catch (const std::invalid_argument&) { threw = true; }\n        assert(threw);\n    }\n    {   // move-only payload\n        BoundedBlockingQueue<std::unique_ptr<int>> q(4);\n        q.push(std::make_unique<int>(5));\n        auto p = q.pop();\n        assert(p && **p == 5);\n    }\n    {   // a producer blocked on a full queue is released by a consumer\n        BoundedBlockingQueue<int> q(1);\n        q.push(1);\n        std::atomic<bool> pushed{false};\n        std::thread t([&] { q.push(2); pushed = true; });\n        std::this_thread::sleep_for(std::chrono::milliseconds(20));\n        assert(!pushed);                          // still blocked\n        assert(*q.pop() == 1);\n        t.join();\n        assert(pushed && *q.pop() == 2);\n    }\n    {   // close() wakes consumers blocked on an empty queue\n        BoundedBlockingQueue<int> q(4);\n        std::vector<std::thread> cs;\n        std::atomic<int> stopped{0};\n        for (int i = 0; i < 3; ++i) cs.emplace_back([&] { if (!q.pop()) ++stopped; });\n        std::this_thread::sleep_for(std::chrono::milliseconds(20));\n        q.close();\n        for (auto& t : cs) t.join();\n        assert(stopped == 3);\n    }\n    {   // MPMC: 4 producers, 4 consumers, small capacity, every item consumed exactly once\n        constexpr int kProducers = 4, kConsumers = 4, kItems = 20000;\n        BoundedBlockingQueue<int> q(8);\n        std::vector<std::atomic<int>> seen(kProducers * kItems);\n        std::atomic<long long> sum{0};\n        std::vector<std::thread> ps, cs;\n        for (int c = 0; c < kConsumers; ++c)\n            cs.emplace_back([&] { while (auto v = q.pop()) { seen[*v].fetch_add(1); sum += *v; } });\n        for (int p = 0; p < kProducers; ++p)\n            ps.emplace_back([&, p] { for (int i = 0; i < kItems; ++i) assert(q.push(p * kItems + i)); });\n        for (auto& t : ps) t.join();\n        q.close();\n        for (auto& t : cs) t.join();\n        long long n = kProducers * kItems;\n        assert(sum == n * (n - 1) / 2);\n        for (auto& s : seen) assert(s.load() == 1);\n    }\n    std::cout << \"ALL TESTS PASSED\\n\";\n}\n",
   "explanation": "### How it works\nA ring buffer of `capacity` slots (`std::vector<std::optional<T>>`, allocated once) with `head_` and `count_`, all protected by one mutex.\n- **push:** lock; `notFull_.wait(lk, [&]{ return count_ < cap || closed_; })`; if closed return `false`; construct the element at `(head_ + count_) % cap`; `++count_`; unlock; `notEmpty_.notify_one()`.\n- **pop:** lock; `notEmpty_.wait(lk, [&]{ return count_ > 0 || closed_; })`; if `count_ == 0` (so closed and drained) return `nullopt`; move the front element out; advance `head_`; unlock; `notFull_.notify_one()`.\n- **close:** set `closed_` under the lock, then `notify_all` on both condition variables so nobody sleeps forever.\n\n### The rules that make condition variables correct\n1. **Always wait with a predicate** (or a `while` loop). Wake-ups can be spurious, and with several consumers another thread may have taken the element between the notify and your wake-up.\n2. **Change the shared state under the same mutex** the waiters use. Otherwise a notify can happen between a waiter's check and its sleep: a *lost wake-up*.\n3. **Two condition variables**: producers and consumers wait for different things. With one CV and `notify_one` you can wake a thread of the wrong kind and stall.\n4. Notifying after unlocking avoids a \"hurry up and wait\" where the woken thread immediately blocks on the mutex still held by the notifier. Both orders are correct.\n5. Shutdown must use `notify_all`, and `pop` must check \"closed **and** empty\" so that items pushed before `close()` are not lost.\n\n### Blocking queue versus the SPSC ring buffer\n| | Blocking queue | Lock-free SPSC |\n|---|---|---|\n| Producers/consumers | many/many | exactly one/one |\n| Waiting | sleeps (futex), no CPU used | spins (or yields) |\n| Latency | microseconds: lock, possibly a context switch and wake-up | tens of nanoseconds |\n| Back-pressure | built in (blocks) | caller decides (spin, drop) |\n| Use for | logging, persistence, reporting | market data to strategy to order gateway |\n\n### Pitfalls\n- Using `if` instead of `while`/predicate around `wait`.\n- Using `std::queue`/`std::deque`: correct, but it allocates as it grows, which the constraint forbids.\n- Returning a reference to the front element and popping separately (the `std::queue` API) is racy across threads; `pop()` must return the value.\n- Forgetting `close()`: consumer threads blocked in `pop` can never be joined, so the program hangs at exit.\n",
   "followUps": [
    "Add push_for/pop_for with a timeout (wait_for). What should a timed-out push return?",
    "Replace the two CVs with C++20 std::counting_semaphore (slots and items). Is it simpler? Is it faster?",
    "Batch pop: take everything available under one lock. When does that help throughput?",
    "Why can a consumer thread holding the mutex be preempted, and what does that do to tail latency for everyone else?",
    "Design the logging path of a trading system: why does the hot thread write to an SPSC queue while a background thread does the blocking I/O?"
   ]
  },
  {
   "id": "fixed-lru-cache",
   "title": "Allocation-Free LRU Cache",
   "origin": "practice",
   "difficulty": "Hard",
   "topics": [
    "LRU cache",
    "open addressing",
    "intrusive list",
    "free list",
    "no heap on the hot path"
   ],
   "sessions": [
    3,
    4
   ],
   "statement": "### Problem Description\nImplement `FixedLruCache<V>`, a least-recently-used cache with a fixed capacity that **performs no heap allocation after construction**. Caches keyed by an integer id (instrument id, client order id, session id) appear throughout trading systems, for example the reference data for the last few thousand instruments a strategy touched. The textbook LRU (`std::list` plus `std::unordered_map`) allocates a list node and a hash node on every insert and frees them on every eviction, which puts the general allocator on the hot path and scatters the data across memory. Here all nodes come from one array, the recency list links nodes by index, and the hash table uses open addressing over a flat array.\n\nThe cache should:\n- allocate all node storage and the hash table once, in the constructor\n- keep the entries in a doubly linked recency list (most recent at the front), linked by 32-bit indices into the node array\n- find a key with an open-addressing hash table (linear probing) that stores node indices\n- on `get` hit, move the entry to the front; on `put` of a new key when full, evict the entry at the back and reuse its node\n- support `erase`, returning the node to a free list; delete from the hash table without tombstones (backward-shift deletion)\n\n### Function Signature\n```cpp\ntemplate <typename V>\nclass FixedLruCache {\npublic:\n    explicit FixedLruCache(std::size_t capacity);\n    V* get(std::uint64_t key);\n    template <typename U> bool put(std::uint64_t key, U&& value);\n    bool erase(std::uint64_t key);\n    bool contains(std::uint64_t key) const;\n    std::size_t size() const;\n    std::uint64_t lruKey() const;\n};\n```\n\n### Constraints\n- `capacity >= 1`, otherwise the constructor throws `std::invalid_argument`\n- `get`, `put`, `erase` are O(1) expected; none of them allocates (beyond what `V`'s own assignment does)\n- the hash table has a power-of-two size at least twice the capacity (load factor <= 0.5)\n- `put` returns `true` exactly when it evicted an entry; updating an existing key never evicts\n- behaviour must match a reference `std::list` + `std::unordered_map` LRU for any sequence of operations\n\n### Example\n```cpp\nFixedLruCache<int> c(2);\nc.put(1, 1);\nc.put(2, 2);\nc.get(1);          // returns pointer to 1; key 1 is now most recent\nc.put(3, 3);       // true: evicts key 2\nc.get(2);          // nullptr\nc.put(4, 4);       // true: evicts key 1\n// output: get(1) == nullptr, *get(3) == 3, *get(4) == 4\n```\n",
   "signature": "#include <cstddef>\n#include <cstdint>\n#include <vector>\n\ntemplate <typename V>\nclass FixedLruCache {\n    // TODO: all nodes allocated once, linked into a recency list without pointers to the heap\n    // TODO: a lookup structure from key to node that does not allocate per insert\n\npublic:\n    explicit FixedLruCache(std::size_t capacity);\n\n    V* get(std::uint64_t key);                       // nullptr if absent; marks the key most recent\n    template <typename U>\n    bool put(std::uint64_t key, U&& value);          // insert/update; true if an entry was evicted\n    bool erase(std::uint64_t key);\n    bool contains(std::uint64_t key) const;\n    std::size_t size() const;\n    std::uint64_t lruKey() const;                    // next eviction victim\n};\n",
   "hints": [
    "Start from the classic design (hash map to list node, list ordered by recency) and replace both containers: a std::vector<Node> allocated once, and prev/next stored as uint32_t indices into it.",
    "Keep a free list of unused nodes threaded through `next`. put takes a free node if one exists; otherwise it unlinks the tail (LRU) node, removes its key from the table, and reuses the node.",
    "For lookup use a power-of-two array of node indices with linear probing. For deletion, shift later entries of the same probe chain back into the hole instead of leaving a tombstone, and re-probe for the new key after an eviction."
   ],
   "checks": [
    {
     "label": "Doubly linked recency list (prev and next links)",
     "patterns": [
      "prev"
     ]
    },
    {
     "label": "Moves an accessed entry to the front",
     "patterns": [
      "pushFront|push_front|moveToFront|move_to_front|toFront|splice|addToHead|add_to_head|insertFront"
     ]
    },
    {
     "label": "Evicts from the least-recently-used end",
     "patterns": [
      "tail",
      "back",
      "lru"
     ]
    },
    {
     "label": "Preallocates nodes (vector / array sized once)",
     "patterns": [
      "std::vector\\s*<\\s*Node",
      "std::array\\s*<\\s*Node",
      "nodes\\w*\\s*\\(\\s*capacity",
      "reserve\\s*\\("
     ]
    },
    {
     "label": "Open-addressing / probing hash table",
     "patterns": [
      "probe",
      "mask",
      "&\\s*\\(\\s*\\w+\\s*-\\s*1\\s*\\)"
     ]
    },
    {
     "label": "Reuses freed or evicted nodes",
     "patterns": [
      "free"
     ]
    },
    {
     "label": "Signals a miss with nullptr / optional",
     "patterns": [
      "nullptr",
      "nullopt"
     ]
    }
   ],
   "solution": "#include <bit>\n#include <cstddef>\n#include <cstdint>\n#include <stdexcept>\n#include <utility>\n#include <vector>\n\n// LRU cache with a fixed capacity that never allocates after construction.\n//  - nodes: one preallocated array, linked into an intrusive doubly linked list by INDEX\n//    (front = most recently used, back = least recently used); unused nodes form a free list\n//  - lookup: open-addressing hash table (linear probing) of node indices, deletion by\n//    backward shift, so there are no tombstones and probe chains stay short\ntemplate <typename V>\nclass FixedLruCache {\n    static constexpr std::uint32_t kNil = 0xFFFFFFFFu;\n\n    struct Node {\n        std::uint64_t key = 0;\n        V value{};\n        std::uint32_t prev = kNil, next = kNil;\n    };\n\n    std::vector<Node> nodes_;\n    std::vector<std::uint32_t> table_;     // node index or kNil; size is a power of two >= 2 * capacity\n    std::size_t mask_;\n    std::uint32_t head_ = kNil, tail_ = kNil, free_ = kNil;\n    std::size_t size_ = 0;\n\n    static std::uint64_t mix(std::uint64_t x) noexcept {   // splitmix64 finaliser: spreads ids\n        x ^= x >> 30; x *= 0xBF58476D1CE4E5B9ull;\n        x ^= x >> 27; x *= 0x94D049BB133111EBull;\n        return x ^ (x >> 31);\n    }\n    std::size_t home(std::uint64_t key) const noexcept { return mix(key) & mask_; }\n\n    // Returns the table slot holding `key`, or the empty slot where it would go.\n    std::size_t probe(std::uint64_t key) const noexcept {\n        std::size_t i = home(key);\n        while (table_[i] != kNil && nodes_[table_[i]].key != key) i = (i + 1) & mask_;\n        return i;\n    }\n\n    void tableErase(std::size_t i) noexcept {      // backward-shift deletion\n        for (std::size_t j = i;;) {\n            j = (j + 1) & mask_;\n            if (table_[j] == kNil) break;\n            const std::size_t k = home(nodes_[table_[j]].key);\n            // Move entry j back into the hole at i unless its home lies cyclically in (i, j].\n            const bool between = (i <= j) ? (i < k && k <= j) : (i < k || k <= j);\n            if (!between) { table_[i] = table_[j]; i = j; }\n        }\n        table_[i] = kNil;\n    }\n\n    void unlink(std::uint32_t n) noexcept {\n        Node& x = nodes_[n];\n        if (x.prev != kNil) nodes_[x.prev].next = x.next; else head_ = x.next;\n        if (x.next != kNil) nodes_[x.next].prev = x.prev; else tail_ = x.prev;\n        x.prev = x.next = kNil;\n    }\n    void pushFront(std::uint32_t n) noexcept {\n        Node& x = nodes_[n];\n        x.prev = kNil; x.next = head_;\n        if (head_ != kNil) nodes_[head_].prev = n; else tail_ = n;\n        head_ = n;\n    }\n\npublic:\n    explicit FixedLruCache(std::size_t capacity)\n        : nodes_(capacity), table_(std::bit_ceil(capacity * 2), kNil), mask_(table_.size() - 1) {\n        if (capacity == 0 || capacity >= kNil) throw std::invalid_argument(\"bad capacity\");\n        for (std::uint32_t i = 0; i < capacity; ++i) nodes_[i].next = (i + 1 < capacity) ? i + 1 : kNil;\n        free_ = 0;\n    }\n\n    // Returns a pointer to the value (valid until the entry is evicted) and marks it most recent.\n    V* get(std::uint64_t key) noexcept {\n        const std::uint32_t n = table_[probe(key)];\n        if (n == kNil) return nullptr;\n        if (n != head_) { unlink(n); pushFront(n); }\n        return &nodes_[n].value;\n    }\n\n    // Insert or overwrite. When full, evicts the least recently used entry. Returns true if\n    // something was evicted.\n    template <typename U>\n    bool put(std::uint64_t key, U&& value) {\n        std::size_t slot = probe(key);\n        if (table_[slot] != kNil) {                       // update in place\n            const std::uint32_t n = table_[slot];\n            nodes_[n].value = std::forward<U>(value);\n            if (n != head_) { unlink(n); pushFront(n); }\n            return false;\n        }\n        bool evicted = false;\n        std::uint32_t n;\n        if (free_ != kNil) {                              // take a never-used / freed node\n            n = free_;\n            free_ = nodes_[n].next;\n        } else {                                          // recycle the LRU node\n            n = tail_;\n            unlink(n);\n            tableErase(probe(nodes_[n].key));\n            --size_;\n            evicted = true;\n            slot = probe(key);                            // the shift may have moved our slot\n        }\n        nodes_[n].key = key;\n        nodes_[n].value = std::forward<U>(value);\n        table_[slot] = n;\n        pushFront(n);\n        ++size_;\n        return evicted;\n    }\n\n    bool erase(std::uint64_t key) noexcept {\n        const std::size_t slot = probe(key);\n        const std::uint32_t n = table_[slot];\n        if (n == kNil) return false;\n        tableErase(slot);\n        unlink(n);\n        nodes_[n].next = free_;                           // back on the free list\n        free_ = n;\n        --size_;\n        return true;\n    }\n\n    bool contains(std::uint64_t key) const noexcept { return table_[probe(key)] != kNil; }\n    std::size_t size() const noexcept { return size_; }\n    std::size_t capacity() const noexcept { return nodes_.size(); }\n    // Least recently used key (the next eviction victim); precondition: size() > 0.\n    std::uint64_t lruKey() const noexcept { return nodes_[tail_].key; }\n};\n",
   "tests": "#include <cassert>\n#include <iostream>\n#include <list>\n#include <random>\n#include <string>\n#include <unordered_map>\n\n// Reference implementation for differential testing.\nstruct RefLru {\n    std::size_t cap;\n    std::list<std::pair<std::uint64_t, int>> l;\n    std::unordered_map<std::uint64_t, std::list<std::pair<std::uint64_t, int>>::iterator> m;\n    int* get(std::uint64_t k) {\n        auto it = m.find(k);\n        if (it == m.end()) return nullptr;\n        l.splice(l.begin(), l, it->second);\n        return &it->second->second;\n    }\n    bool put(std::uint64_t k, int v) {\n        if (auto it = m.find(k); it != m.end()) { it->second->second = v; l.splice(l.begin(), l, it->second); return false; }\n        bool ev = false;\n        if (l.size() == cap) { m.erase(l.back().first); l.pop_back(); ev = true; }\n        l.emplace_front(k, v); m[k] = l.begin();\n        return ev;\n    }\n    bool erase(std::uint64_t k) {\n        auto it = m.find(k);\n        if (it == m.end()) return false;\n        l.erase(it->second); m.erase(it); return true;\n    }\n};\n\nint main() {\n    {   // the statement's example (same semantics as LeetCode 146)\n        FixedLruCache<int> c(2);\n        c.put(1, 1);\n        c.put(2, 2);\n        assert(*c.get(1) == 1);             // 1 becomes most recent\n        assert(c.put(3, 3));                // evicts 2\n        assert(c.get(2) == nullptr);\n        assert(c.put(4, 4));                // evicts 1\n        assert(!c.get(1) && *c.get(3) == 3 && *c.get(4) == 4);\n        assert(c.size() == 2 && c.lruKey() == 3);\n        assert(!c.put(4, 40) && *c.get(4) == 40);   // update does not evict\n        assert(c.erase(3) && !c.erase(3) && c.size() == 1);\n        assert(!c.put(5, 5) && c.size() == 2);      // freed node reused, no eviction\n    }\n    {   // non-trivial value type\n        FixedLruCache<std::string> c(3);\n        c.put(10, std::string(50, 'a'));\n        c.put(11, \"b\");\n        assert(c.get(10)->size() == 50);\n    }\n    {   // differential test, with keys that collide heavily in the table\n        for (std::size_t cap : {1u, 2u, 7u, 64u, 500u}) {\n            FixedLruCache<int> c(cap);\n            RefLru r{cap, {}, {}};\n            std::mt19937_64 rng(cap);\n            for (int step = 0; step < 100000; ++step) {\n                const std::uint64_t k = (rng() % (cap * 3 + 2)) * 1024;   // structured ids\n                switch (rng() % 4) {\n                    case 0: case 1: { int v = static_cast<int>(rng() % 1000); assert(c.put(k, v) == r.put(k, v)); break; }\n                    case 2: { int* a = c.get(k); int* b = r.get(k); assert((a == nullptr) == (b == nullptr)); if (a) assert(*a == *b); break; }\n                    default: assert(c.erase(k) == r.erase(k));\n                }\n                assert(c.size() == r.l.size());\n                if (c.size()) assert(c.lruKey() == r.l.back().first);\n            }\n        }\n    }\n    std::cout << \"ALL TESTS PASSED\\n\";\n}\n",
   "explanation": "### How it works\n- **Nodes:** `std::vector<Node>` of size `capacity`, allocated once. Each node stores the key, the value and `prev`/`next` as 32-bit indices. Indices instead of pointers halve the link size and stay valid if the array is moved. Never-used and erased nodes are chained through `next` into a free list, exactly like the memory pool.\n- **Recency list:** `head_` = most recently used, `tail_` = least. `get` and `put` unlink the node and push it to the front in O(1). Eviction takes `tail_`.\n- **Hash table:** `std::vector<uint32_t>` of node indices, size `bit_ceil(2 * capacity)` so the slot is `hash & mask` and the load factor stays <= 0.5. Lookups probe linearly from the key's home slot until they find the key or an empty slot. A cheap mixer (splitmix64) spreads structured ids such as multiples of 1024, which would otherwise collide in the low bits.\n- **Deletion without tombstones (backward shift):** after emptying slot `i`, walk forward; any entry whose home slot is *not* cyclically between the hole and its current position is moved back into the hole. This keeps every probe chain unbroken, so the table never degrades the way tombstones make it degrade.\n- **The subtle bug:** when `put` evicts, the backward shift can move entries, including into the empty slot where the new key was going to go. The solution therefore probes again after the eviction.\n\n### Complexity\n`get`/`put`/`erase` are O(1) expected (short probe sequences at load factor 0.5); memory is `capacity * (sizeof(V) + 16)` plus `8 * capacity` bytes of table, all contiguous.\n\n### Why this is the low-latency version of LeetCode 146\n| | `std::list` + `std::unordered_map` | this cache |\n|---|---|---|\n| Allocation per insert | 2 (list node, hash node) | 0 |\n| Memory layout | scattered nodes | two flat arrays |\n| Hash collisions | chained buckets (pointer chasing) | linear probing (sequential cache lines) |\n| Rehash latency spikes | yes, when the load factor is exceeded | never: the size is fixed |\n\n### Pitfalls\n- Tombstone-based deletion: correct, but tables fill with tombstones and lookups slow down over time.\n- Forgetting to re-probe after an eviction (see above): the differential test catches it.\n- Using `std::hash<uint64_t>`: in libstdc++ and libc++ it is the identity, so keys with equal low bits collide.\n- Returning `V*` from `get`: the pointer is invalidated when that entry is evicted; document it, or return a copy for small `V`.\n",
   "followUps": [
    "Make it an LFU cache with O(1) operations (frequency buckets, LeetCode 460) under the same no-allocation rule.",
    "Make it safe for many reader threads. Why does an LRU's get() make that hard (every read is a write to the list), and what do CLOCK or sampled LRU change?",
    "Replace linear probing with Robin Hood hashing. What does it do to the worst-case probe length?",
    "Store keys in a separate array from values (struct of arrays). Why can that make probing faster?",
    "Add a TTL: entries older than T are treated as misses. Where do you keep the timestamp so that get() stays O(1)?"
   ]
  }
 ],
 "leetcode": [
  {
   "num": 2502,
   "title": "Design Memory Allocator",
   "slug": "design-memory-allocator",
   "url": "https://leetcode.com/problems/design-memory-allocator/",
   "difficulty": "Medium",
   "premium": false,
   "why": "The closest LeetCode gets to the memory pool: hand out and free contiguous blocks of a fixed arena by id.",
   "topic": "Memory / allocators"
  },
  {
   "num": 146,
   "title": "LRU Cache",
   "slug": "lru-cache",
   "url": "https://leetcode.com/problems/lru-cache/",
   "difficulty": "Medium",
   "premium": false,
   "why": "Hash map plus doubly linked list with O(1) get/put; the allocation-free LRU problem is the low-latency version.",
   "topic": "Design / caches"
  },
  {
   "num": 460,
   "title": "LFU Cache",
   "slug": "lfu-cache",
   "url": "https://leetcode.com/problems/lfu-cache/",
   "difficulty": "Hard",
   "premium": false,
   "why": "O(1) frequency buckets of linked lists: practise keeping several intrusive structures consistent.",
   "topic": "Design / caches"
  },
  {
   "num": 622,
   "title": "Design Circular Queue",
   "slug": "design-circular-queue",
   "url": "https://leetcode.com/problems/design-circular-queue/",
   "difficulty": "Medium",
   "premium": false,
   "why": "A fixed-capacity ring with head/tail and full-vs-empty handling, the single-threaded core of the SPSC queue.",
   "topic": "Ring buffers / queues"
  },
  {
   "num": 641,
   "title": "Design Circular Deque",
   "slug": "design-circular-deque",
   "url": "https://leetcode.com/problems/design-circular-deque/",
   "difficulty": "Medium",
   "premium": false,
   "why": "Ring buffer indexed from both ends; practise wrap-around arithmetic without off-by-one errors.",
   "topic": "Ring buffers / queues"
  },
  {
   "num": 706,
   "title": "Design HashMap",
   "slug": "design-hashmap",
   "url": "https://leetcode.com/problems/design-hashmap/",
   "difficulty": "Easy",
   "premium": false,
   "why": "Build a hash table yourself; try open addressing over a flat array instead of buckets of lists.",
   "topic": "Design / hashing"
  },
  {
   "num": 705,
   "title": "Design HashSet",
   "slug": "design-hashset",
   "url": "https://leetcode.com/problems/design-hashset/",
   "difficulty": "Easy",
   "premium": false,
   "why": "Same as Design HashMap without values; a good place to try a bitmap for a bounded key range.",
   "topic": "Design / hashing"
  },
  {
   "num": 155,
   "title": "Min Stack",
   "slug": "min-stack",
   "url": "https://leetcode.com/problems/min-stack/",
   "difficulty": "Medium",
   "premium": false,
   "why": "Stack with O(1) min: an exercise in keeping auxiliary state in sync, like a book's best price.",
   "topic": "Stacks"
  },
  {
   "num": 1801,
   "title": "Number of Orders in the Backlog",
   "slug": "number-of-orders-in-the-backlog",
   "url": "https://leetcode.com/problems/number-of-orders-in-the-backlog/",
   "difficulty": "Medium",
   "premium": false,
   "why": "An actual order book: buy/sell backlogs matched by price, using two heaps.",
   "topic": "Order books"
  },
  {
   "num": 2034,
   "title": "Stock Price Fluctuation",
   "slug": "stock-price-fluctuation",
   "url": "https://leetcode.com/problems/stock-price-fluctuation/",
   "difficulty": "Medium",
   "premium": false,
   "why": "Out-of-order price updates with latest/max/min queries, like correcting a market-data feed.",
   "topic": "Order books / market data"
  },
  {
   "num": 901,
   "title": "Online Stock Span",
   "slug": "online-stock-span",
   "url": "https://leetcode.com/problems/online-stock-span/",
   "difficulty": "Medium",
   "premium": false,
   "why": "Streaming price ticks with an amortised O(1) monotonic stack.",
   "topic": "Market data / stacks"
  },
  {
   "num": 981,
   "title": "Time Based Key-Value Store",
   "slug": "time-based-key-value-store",
   "url": "https://leetcode.com/problems/time-based-key-value-store/",
   "difficulty": "Medium",
   "premium": false,
   "why": "Versioned values by timestamp with binary search, like querying the book as of a time.",
   "topic": "Market data / design"
  },
  {
   "num": 1146,
   "title": "Snapshot Array",
   "slug": "snapshot-array",
   "url": "https://leetcode.com/problems/snapshot-array/",
   "difficulty": "Medium",
   "premium": false,
   "why": "Cheap snapshots by storing per-index change history instead of copying the array.",
   "topic": "Design / versioning"
  },
  {
   "num": 380,
   "title": "Insert Delete GetRandom O(1)",
   "slug": "insert-delete-getrandom-o1",
   "url": "https://leetcode.com/problems/insert-delete-getrandom-o1/",
   "difficulty": "Medium",
   "premium": false,
   "why": "Vector plus index map with swap-and-pop deletion: O(1) erase without holes, a common hot-path trick.",
   "topic": "Design / data structures"
  },
  {
   "num": 432,
   "title": "All O`one Data Structure",
   "slug": "all-oone-data-structure",
   "url": "https://leetcode.com/problems/all-oone-data-structure/",
   "difficulty": "Hard",
   "premium": false,
   "why": "O(1) increment/decrement with ordered buckets: linked levels like price levels in a book.",
   "topic": "Design / data structures"
  },
  {
   "num": 1206,
   "title": "Design Skiplist",
   "slug": "design-skiplist",
   "url": "https://leetcode.com/problems/design-skiplist/",
   "difficulty": "Hard",
   "premium": false,
   "why": "The ordered structure behind many lock-free maps and some order books; compare it with std::map.",
   "topic": "Design / ordered structures"
  },
  {
   "num": 1114,
   "title": "Print in Order",
   "slug": "print-in-order",
   "url": "https://leetcode.com/problems/print-in-order/",
   "difficulty": "Easy",
   "premium": false,
   "why": "Enforce ordering between threads with a mutex/condition variable or atomics with acquire/release.",
   "topic": "Concurrency"
  },
  {
   "num": 1115,
   "title": "Print FooBar Alternately",
   "slug": "print-foobar-alternately",
   "url": "https://leetcode.com/problems/print-foobar-alternately/",
   "difficulty": "Medium",
   "premium": false,
   "why": "Strict hand-off between two threads, a ping-pong like a producer and a consumer taking turns.",
   "topic": "Concurrency"
  },
  {
   "num": 1116,
   "title": "Print Zero Even Odd",
   "slug": "print-zero-even-odd",
   "url": "https://leetcode.com/problems/print-zero-even-odd/",
   "difficulty": "Medium",
   "premium": false,
   "why": "Three-thread coordination with condition variables or semaphores; avoid lost wake-ups.",
   "topic": "Concurrency"
  },
  {
   "num": 1117,
   "title": "Building H2O",
   "slug": "building-h2o",
   "url": "https://leetcode.com/problems/building-h2o/",
   "difficulty": "Medium",
   "premium": false,
   "why": "Barrier-style grouping of threads with semaphores or a mutex plus condition variable.",
   "topic": "Concurrency"
  },
  {
   "num": 1195,
   "title": "Fizz Buzz Multithreaded",
   "slug": "fizz-buzz-multithreaded",
   "url": "https://leetcode.com/problems/fizz-buzz-multithreaded/",
   "difficulty": "Medium",
   "premium": false,
   "why": "Four threads sharing one counter: practise wait-with-predicate and notify_all.",
   "topic": "Concurrency"
  },
  {
   "num": 1226,
   "title": "The Dining Philosophers",
   "slug": "the-dining-philosophers",
   "url": "https://leetcode.com/problems/the-dining-philosophers/",
   "difficulty": "Medium",
   "premium": false,
   "why": "Deadlock avoidance via lock ordering or std::scoped_lock on several mutexes.",
   "topic": "Concurrency"
  },
  {
   "num": 1188,
   "title": "Design Bounded Blocking Queue",
   "slug": "design-bounded-blocking-queue",
   "url": "https://leetcode.com/problems/design-bounded-blocking-queue/",
   "difficulty": "Medium",
   "premium": true,
   "why": "Exactly the bounded producer-consumer queue from the practice set.",
   "topic": "Concurrency / queues"
  },
  {
   "num": 1242,
   "title": "Web Crawler Multithreaded",
   "slug": "web-crawler-multithreaded",
   "url": "https://leetcode.com/problems/web-crawler-multithreaded/",
   "difficulty": "Medium",
   "premium": true,
   "why": "A thread pool with a shared work queue and a visited set; practise shutdown and joining.",
   "topic": "Concurrency"
  },
  {
   "num": 191,
   "title": "Number of 1 Bits",
   "slug": "number-of-1-bits",
   "url": "https://leetcode.com/problems/number-of-1-bits/",
   "difficulty": "Easy",
   "premium": false,
   "why": "Popcount: compare a loop, x &= x - 1, a lookup table and std::popcount.",
   "topic": "Bit manipulation"
  },
  {
   "num": 338,
   "title": "Counting Bits",
   "slug": "counting-bits",
   "url": "https://leetcode.com/problems/counting-bits/",
   "difficulty": "Easy",
   "premium": false,
   "why": "Build a popcount table with the recurrence bits[i] = bits[i >> 1] + (i & 1), as in the constexpr table problem.",
   "topic": "Bit manipulation"
  },
  {
   "num": 190,
   "title": "Reverse Bits",
   "slug": "reverse-bits",
   "url": "https://leetcode.com/problems/reverse-bits/",
   "difficulty": "Easy",
   "premium": false,
   "why": "Shift and mask tricks used in packet decoding and endianness handling.",
   "topic": "Bit manipulation"
  },
  {
   "num": 231,
   "title": "Power of Two",
   "slug": "power-of-two",
   "url": "https://leetcode.com/problems/power-of-two/",
   "difficulty": "Easy",
   "premium": false,
   "why": "x && !(x & (x - 1)): the check behind power-of-two ring capacities.",
   "topic": "Bit manipulation"
  },
  {
   "num": 136,
   "title": "Single Number",
   "slug": "single-number",
   "url": "https://leetcode.com/problems/single-number/",
   "difficulty": "Easy",
   "premium": false,
   "why": "XOR tricks; a reminder that branch-free bit operations are cheap.",
   "topic": "Bit manipulation"
  },
  {
   "num": 371,
   "title": "Sum of Two Integers",
   "slug": "sum-of-two-integers",
   "url": "https://leetcode.com/problems/sum-of-two-integers/",
   "difficulty": "Medium",
   "premium": false,
   "why": "Add with XOR and AND-shift only: how carries work at the bit level.",
   "topic": "Bit manipulation"
  }
 ],
 "otherPlatforms": [
  {
   "platform": "GeeksforGeeks",
   "title": "Introduction to LRU Cache",
   "url": "https://www.geeksforgeeks.org/system-design/lru-cache-implementation/",
   "why": "Hash map plus doubly linked list explained step by step; compare with the allocation-free LRU.",
   "topic": "Caches"
  },
  {
   "platform": "GeeksforGeeks",
   "title": "LRU Cache (Practice)",
   "url": "https://www.geeksforgeeks.org/problems/lru-cache/1",
   "why": "Judge-checked LRU implementation; try it with a preallocated node array.",
   "topic": "Caches"
  },
  {
   "platform": "GeeksforGeeks",
   "title": "Least Frequently Used (LFU) Cache Implementation",
   "url": "https://www.geeksforgeeks.org/dsa/least-frequently-used-lfu-cache-implementation/",
   "why": "O(1) LFU with frequency lists: several linked structures kept consistent.",
   "topic": "Caches"
  },
  {
   "platform": "GeeksforGeeks",
   "title": "Implementation of Circular Queue Using Array",
   "url": "https://www.geeksforgeeks.org/dsa/introduction-to-circular-queue/",
   "why": "Front/rear wrap-around in a fixed array, the single-threaded core of the SPSC ring buffer.",
   "topic": "Ring buffers / queues"
  },
  {
   "platform": "GeeksforGeeks",
   "title": "Queue Using Array (Practice)",
   "url": "https://www.geeksforgeeks.org/problems/implement-queue-using-array/1",
   "why": "Quick drill of a fixed-array queue before adding atomics.",
   "topic": "Ring buffers / queues"
  },
  {
   "platform": "GeeksforGeeks",
   "title": "Implement Stack using Array (Practice)",
   "url": "https://www.geeksforgeeks.org/problems/implement-stack-using-array/1",
   "why": "The single-threaded stack that the lock-free Treiber stack makes concurrent.",
   "topic": "Stacks / lock-free"
  },
  {
   "platform": "GeeksforGeeks",
   "title": "Producer Consumer Solution using Semaphores",
   "url": "https://www.geeksforgeeks.org/operating-systems/producer-consumer-problem-using-semaphores-set-1/",
   "why": "The classic bounded-buffer problem behind the blocking queue (empty/full counting semaphores).",
   "topic": "Concurrency / producer-consumer"
  },
  {
   "platform": "GeeksforGeeks",
   "title": "Condition Variables in C++ Multithreading",
   "url": "https://www.geeksforgeeks.org/cpp/cpp-multithreading-condition-variables/",
   "why": "std::condition_variable with wait-with-predicate, as used in the bounded blocking queue.",
   "topic": "Concurrency / producer-consumer"
  },
  {
   "platform": "GeeksforGeeks",
   "title": "Smart Pointers in C++",
   "url": "https://www.geeksforgeeks.org/cpp/smart-pointers-cpp/",
   "why": "Overview of unique_ptr, shared_ptr and weak_ptr and why raw owning pointers leak; a warm-up for the UniquePtr and SharedPtr problems.",
   "topic": "Smart pointers"
  },
  {
   "platform": "GeeksforGeeks",
   "title": "auto_ptr vs unique_ptr vs shared_ptr vs weak_ptr in C++",
   "url": "https://www.geeksforgeeks.org/cpp/auto_ptr-unique_ptr-shared_ptr-weak_ptr-in-cpp/",
   "why": "Ownership models compared, including why auto_ptr's copy-that-moves was removed.",
   "topic": "Smart pointers"
  },
  {
   "platform": "GeeksforGeeks",
   "title": "Move Semantics in C++",
   "url": "https://www.geeksforgeeks.org/cpp/stdmove-in-utility-in-c-move-semantics-move-constructors-and-move-assignment-operators/",
   "why": "Move constructors and assignment, needed for the SSO String and the in-place vector.",
   "topic": "Move semantics / strings"
  },
  {
   "platform": "GeeksforGeeks",
   "title": "The Rule of Five in C++",
   "url": "https://www.geeksforgeeks.org/cpp/rule-of-five-in-cpp/",
   "why": "The five special members every resource-owning class in this set implements.",
   "topic": "Move semantics / strings"
  },
  {
   "platform": "GeeksforGeeks",
   "title": "Placement new operator in C++",
   "url": "https://www.geeksforgeeks.org/cpp/placement-new-operator-cpp/",
   "why": "Constructing objects in memory you already own: the memory pool and in-place vector rely on it.",
   "topic": "Memory / allocators"
  },
  {
   "platform": "GeeksforGeeks",
   "title": "Structure Member Alignment, Padding and Data Packing",
   "url": "https://www.geeksforgeeks.org/c/structure-member-alignment-padding-and-data-packing/",
   "why": "Alignment and padding rules behind alignas, pool slot sizes and cache-line layout.",
   "topic": "Memory / cache-friendly design"
  },
  {
   "platform": "GeeksforGeeks",
   "title": "How to implement our own Vector Class in C++?",
   "url": "https://www.geeksforgeeks.org/cpp/how-to-implement-our-own-vector-class-in-c/",
   "why": "A growing vector to contrast with the fixed-capacity in-place vector.",
   "topic": "Memory / containers"
  },
  {
   "platform": "GeeksforGeeks",
   "title": "Count Set Bits (Practice)",
   "url": "https://www.geeksforgeeks.org/problems/set-bits0143/1",
   "why": "Popcount drill; compare a loop, a lookup table and std::popcount.",
   "topic": "Bit manipulation"
  },
  {
   "platform": "GeeksforGeeks",
   "title": "Curiously recurring template pattern (CRTP)",
   "url": "https://www.geeksforgeeks.org/system-design/curiously-recurring-template-pattern-crtp-2/",
   "why": "Static polymorphism versus virtual dispatch, as in the CRTP feed handler.",
   "topic": "Templates / compile time"
  },
  {
   "platform": "HackerRank",
   "title": "Abstract Classes - Polymorphism",
   "url": "https://www.hackerrank.com/challenges/abstract-classes-polymorphism/problem",
   "why": "Despite the name, this C++ track problem asks you to implement an LRU cache.",
   "topic": "Caches"
  },
  {
   "platform": "HackerRank",
   "title": "Bit Array",
   "url": "https://www.hackerrank.com/challenges/bitset-1/problem",
   "why": "Count distinct values of a pseudo-random sequence over a 2^31 range under tight limits; rewards bit tricks and O(1) extra memory.",
   "topic": "Bit manipulation"
  },
  {
   "platform": "Codeforces",
   "title": "Order book (1028D)",
   "url": "https://codeforces.com/problemset/problem/1028/D",
   "why": "Given a log of ADD and ACCEPT actions, count the ways to label them as buys/sells so that every best bid stays below every best ask.",
   "topic": "Order books"
  },
  {
   "platform": "Codeforces",
   "title": "Order Book (572B)",
   "url": "https://codeforces.com/problemset/problem/572/B",
   "why": "Aggregate orders by price and print the best levels on each side: a market-by-price book.",
   "topic": "Order books"
  }
 ]
};
