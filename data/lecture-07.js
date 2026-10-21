window.PAGE = {
 "num": 7,
 "title": "Move Semantics 2 + Smart Pointers",
 "summary": "Applying move semantics to real classes so they make fewer copies: RAII, Rule of 0 vs hand-written moves, std::exchange, sink parameters, emplace, ref-qualified getters, and why noexcept decides whether vector copies or moves. Then smart pointers built from the class SmartPointer sketch: unique_ptr internals and deleters, the shared_ptr control block (with the class's refcount trace and the two-control-block trap), weak_ptr cycles, and smart-pointer rules for the hot path.",
 "notes": [
  {
   "heading": "Why custom classes need ownership rules: RAII",
   "body": "**RAII (Resource Acquisition Is Initialisation):** tie a resource's lifetime to an object's scope. The constructor acquires (memory, a socket fd, a lock, a pooled slot); the destructor releases. Destructors run automatically at scope exit, including when an exception propagates, so you can't forget.\n\n**In class (Lec-7 `program.cpp` vs `person_stack.cpp`):** the same `Person` with a destructor that prints `\"<id> Person delete\"`:\n\n```cpp\nvoid f()      { Person* p = new Person(1, 12, 0); }  // prints NOTHING: the pointer dies,\n                                                     // the heap object is never destroyed (a leak)\nvoid fKartik(){ Person person{1, 12, 0}; }           // prints \"1 Person delete\" at the closing brace\n```\n\nA raw owning pointer has no destructor, so nothing cleans up. C++ has **no garbage collector**; the fix is either a stack object (when the lifetime is the scope) or a **smart pointer**, an RAII object whose destructor calls `delete`.\n\nOnce a class owns something, you must decide what **copy** and **move** mean for it:\n\n| Resource | Copy | Move |\n|---|---|---|\n| heap buffer (string, vector) | deep copy (allocate + memcpy) | steal pointer, O(1) |\n| unique owner (unique_ptr, socket, file) | **deleted** | transfer ownership |\n| shared owner (shared_ptr) | share + increment count | transfer, no count change |\n| plain data (POD `Order` of ints) | memcpy | same as copy |"
  },
  {
   "heading": "Designing a move-aware custom class",
   "body": "Start from the **Rule of 0**: if every member already handles itself, write no special members and the compiler generates correct, `noexcept` moves.\n\n```cpp\nstruct Order {                       // Rule of 0: moves are generated and noexcept\n    uint64_t           id;\n    int64_t            px;\n    uint32_t           qty;\n    std::string        clientTag;    // may own heap memory\n    std::vector<Fill>  fills;        // owns heap memory\n};\nstatic_assert(std::is_nothrow_move_constructible_v<Order>);\n```\n\nWrite the special members yourself only when the class directly owns a raw resource (a buffer from a pool, an fd, an mmap'd region). Then:\n1. Destructor releases.\n2. Copy: deep copy, or `= delete` if copying makes no sense.\n3. Move: steal, leave the source empty, mark `noexcept`.\n4. Never declare *only* a destructor: it silently removes the implicit moves, so every \"move\" becomes a copy.\n\nTo *see* the copies, instrument a class (a common interview and lab exercise):\n\n```cpp\nstruct Tracer {\n    static inline int copies = 0, moves = 0;\n    Tracer() = default;\n    Tracer(const Tracer&)            { ++copies; }\n    Tracer(Tracer&&) noexcept        { ++moves; }\n    Tracer& operator=(const Tracer&) { ++copies; return *this; }\n    Tracer& operator=(Tracer&&) noexcept { ++moves; return *this; }\n};\n```\n\n`for (5 times) v.push_back(Tracer{});` with no `reserve` gives **0 copies, 12 moves** (5 pushes + 1 + 2 + 4 moves on reallocations at capacity 1, 2, 4). With `v.reserve(5); v.emplace_back();` it's **0 copies, 0 moves**. Remove `noexcept` from the move ctor and the 7 reallocation moves become **copies**."
  },
  {
   "heading": "Writing the move operations correctly",
   "body": "```cpp\nclass PoolBuffer {\n    std::byte*  data_ = nullptr;\n    std::size_t size_ = 0;\npublic:\n    explicit PoolBuffer(std::size_t n) : data_(new std::byte[n]), size_(n) {}\n    ~PoolBuffer() { delete[] data_; }\n\n    PoolBuffer(const PoolBuffer&) = delete;              // unique ownership\n    PoolBuffer& operator=(const PoolBuffer&) = delete;\n\n    PoolBuffer(PoolBuffer&& o) noexcept\n        : data_(std::exchange(o.data_, nullptr)),        // steal and null in one step\n          size_(std::exchange(o.size_, 0)) {}\n\n    PoolBuffer& operator=(PoolBuffer&& o) noexcept {\n        if (this != &o) {                               // x = std::move(x) must not free x\n            delete[] data_;                              // release our old resource first\n            data_ = std::exchange(o.data_, nullptr);\n            size_ = std::exchange(o.size_, 0);\n        }\n        return *this;\n    }\n    friend void swap(PoolBuffer& a, PoolBuffer& b) noexcept {\n        std::swap(a.data_, b.data_); std::swap(a.size_, b.size_);\n    }\n};\n```\n\nChecklist:\n- **Steal**, then **reset the source** so its destructor is harmless (no double free).\n- **Release** your old resource in move assignment (otherwise a leak).\n- Handle **self-move** (or use move-and-swap: `T& operator=(T o) noexcept { swap(*this, o); return *this; }`).\n- Mark both `noexcept`; they only shuffle pointers.\n- `std::exchange(obj, newVal)` returns the old value: perfect for \"take and null\".\n- `= default` the moves when memberwise moves are right; `= delete` copies for unique owners."
  },
  {
   "heading": "Applying move semantics for fewer copies",
   "body": "Practical moves that remove copies from real code:\n\n```cpp\n// 1. Sink parameter: take by value, move into place\nclass Instrument {\n    std::string sym_;\npublic:\n    explicit Instrument(std::string sym) : sym_(std::move(sym)) {}\n};\nInstrument a{\"AAPL\"};          // temp -> moved, no copy\nstd::string s = loadSym();\nInstrument b{s};               // one copy (we keep s)\nInstrument c{std::move(s)};    // zero copies (we give s away)\n\n// 2. Construct in place instead of building a temporary\nbook.emplace_back(id, px, qty);           // vs push_back(Order{id, px, qty})\nlevels.try_emplace(px, /*args*/);         // map: constructs only if the key is new\n\n// 3. Last use of a local: move it\nstd::vector<Fill> fills = collect();\nreport.setFills(std::move(fills));        // fills is dead after this line\n\n// 4. Move out of a container you're discarding\nstd::string msg = std::move(queue.front()); queue.pop_front();\n\n// 5. Return by value: RVO/NRVO/implicit move, never a copy\nstd::vector<Order> loadOrders();\n\n// 6. Pre-size: no reallocation, no element moves at all\norders.reserve(expected);\n```\n\n**In class (Lec-8 `checking.cpp`):** ref-qualified member functions (`print() const &` vs `print() const &&`) pick an overload by the object's value category. The same trick avoids copies in getters:\n\n```cpp\nstruct Order {\n    std::string sym;\n    const std::string& symbol() const & { return sym; }            // lvalue Order: no copy\n    std::string        symbol() &&      { return std::move(sym); } // expiring Order: steal it\n};\nstd::string s = makeOrder().symbol();     // moves the string out of the temporary\n```\n\nMoving a whole container is O(1) (three pointers for `vector`, pointer swaps for `map`/`list`), except `std::array`, which has no heap buffer, so its \"move\" moves each element: O(n)."
  },
  {
   "heading": "Moves inside the standard containers (noexcept matters)",
   "body": "- **`vector` growth:** new buffer (usually 2x for libstdc++/libc++), elements transferred with `std::move_if_noexcept`, so they're **moved only if the move constructor is `noexcept`** (or the type isn't copyable). Otherwise they're copied, to keep the strong exception guarantee.\n- **`insert`/`erase` in the middle of a vector:** elements are shifted with move assignment, O(n).\n- **`std::swap(a, b)`** for a type with moves = 3 moves; for containers it's specialised to O(1) pointer swaps.\n- **Node containers** (`list`, `map`, `unordered_map`) never move elements on growth; C++17 `extract()` / `insert(node)` moves a node between maps with **no allocation and no element copy**.\n- **`std::sort` and friends** use moves and swaps, so cheap moves make sorting `vector<Order>` fast; better still, sort indices or small keys.\n\n| Operation | Elements copied? |\n|---|---|\n| `v.push_back(x)` (lvalue) | 1 copy |\n| `v.push_back(std::move(x))` | 1 move |\n| `v.emplace_back(args...)` | constructed in place |\n| reallocation with `noexcept` move | moves |\n| reallocation, throwing move + copyable | **copies** |\n| `auto w = std::move(v);` | none (buffer stolen) |"
  },
  {
   "heading": "Moved-from objects and move pitfalls",
   "body": "After `auto b = std::move(a);`, `a` is **valid but unspecified**: you may destroy it, assign to it, or call functions without preconditions (`a.clear()`, `a.size()`). Don't rely on its value.\n\nCommon bugs:\n\n```cpp\n// use after move\nprocess(std::move(order));\nlog(order.id);                       // bug: order may be gutted (fine only for trivially\n                                     // copyable members, but don't rely on it)\n\n// moving inside a loop\nfor (int i = 0; i < 3; ++i) send(std::move(msg));   // 2nd and 3rd sends get an empty msg\n\n// order of evaluation\nf(std::move(s), s.size());           // unspecified which argument is evaluated first\n                                     // (the move itself only happens inside f, but don't do this)\n\n// moving from const: silently copies\nconst std::string tag = \"X\"; v.push_back(std::move(tag));\n\n// lambda: move a big object into the closure (C++14 init capture)\nauto task = [buf = std::move(buffer)]() { use(buf); };\n```\n\nGuaranteed states: a moved-from `unique_ptr` is **null**; a moved-from `shared_ptr` is **empty**; standard containers are valid (in practice empty). Your own types should follow the same rule: leave the source in a state the destructor and assignment can handle."
  },
  {
   "heading": "Smart pointers from scratch: the class SmartPointer and its bugs",
   "body": "**In class (Lec-11 `smart_ppinters.cpp`):** the instructor started with the RAII idea:\n\n```cpp\ntemplate <typename T>\nclass SmartPointer {\npublic:\n    SmartPointer(T* p) : ptr(p) {}\n    ~SmartPointer() { delete p; }   // as written in class\n    T* ptr;\n};\nvoid f() { SmartPointer obj(new int[1000]); }   // freed when obj goes out of scope\n```\n\nThe idea is exactly right: the destructor frees the memory, so `f()` can't leak. As an exam \"find the bugs\" exercise:\n\n1. `delete p;` refers to the constructor parameter, which is out of scope: it must be `delete ptr;` (compile error as written).\n2. Memory from `new int[1000]` must be freed with **`delete[]`**; `delete` on an array is **UB**. Use a `SmartPointer<int[]>` specialisation (as `std::unique_ptr<T[]>` does) or a custom deleter.\n3. The implicit **copy constructor** copies `ptr`, so two objects delete the same memory: a **double free**. A unique owner must `= delete` its copy operations and implement **move** instead.\n4. The constructor should be `explicit` (no accidental conversion from `T*`), and `ptr` should be private, with `operator*`, `operator->`, `get()`, `release()`, `reset()`.\n\nFixing all four gives you `std::unique_ptr`."
  },
  {
   "heading": "std::unique_ptr: zero-overhead unique ownership",
   "body": "```cpp\ntemplate <typename T>\nclass UniquePtr {\n    T* ptr_ = nullptr;\npublic:\n    UniquePtr() = default;\n    explicit UniquePtr(T* p) noexcept : ptr_(p) {}\n    ~UniquePtr() { delete ptr_; }\n    UniquePtr(const UniquePtr&) = delete;                 // no copies\n    UniquePtr& operator=(const UniquePtr&) = delete;\n    UniquePtr(UniquePtr&& o) noexcept : ptr_(std::exchange(o.ptr_, nullptr)) {}\n    UniquePtr& operator=(UniquePtr&& o) noexcept {\n        if (this != &o) { delete ptr_; ptr_ = std::exchange(o.ptr_, nullptr); }\n        return *this;\n    }\n    T& operator*()  const noexcept { return *ptr_; }\n    T* operator->() const noexcept { return ptr_; }\n    T* get()        const noexcept { return ptr_; }\n    T* release()          noexcept { return std::exchange(ptr_, nullptr); } // caller now owns it\n    void reset(T* p = nullptr) noexcept { delete std::exchange(ptr_, p); }\n    explicit operator bool() const noexcept { return ptr_ != nullptr; }\n};\n```\n\nFacts about `std::unique_ptr`:\n- `sizeof(unique_ptr<T>)` = **8** (the default deleter is an empty class, stored with EBO). `->` compiles to the same instruction as a raw pointer.\n- A **custom deleter** may add size: a stateless lambda keeps it at 8; a function pointer (`unique_ptr<FILE, int(*)(FILE*)>`) makes it **16**.\n- `std::make_unique<T>(args...)` (C++14): no naked `new`, exception-safe.\n- `unique_ptr<T[]>` calls `delete[]` and provides `operator[]`; `make_unique<int[]>(n)` value-initialises (zeroes) the array.\n- Move-only: `auto p2 = std::move(p1);` leaves `p1` null; you can store them in `vector<unique_ptr<T>>` (vector moves them).\n- `unique_ptr<Base>` holding a `Derived` requires a **virtual destructor** in `Base`.\n- Converts implicitly to `shared_ptr` (`std::shared_ptr<T> s = std::move(u);`).\n\nHFT use: pool-backed objects with a custom deleter that returns the slot to the pool instead of calling `delete`:\n\n```cpp\nstruct PoolDeleter { OrderPool* pool; void operator()(Order* o) const noexcept { pool->release(o); } };\nusing PooledOrder = std::unique_ptr<Order, PoolDeleter>;   // 16 bytes (pointer + pool*)\n```"
  },
  {
   "heading": "std::shared_ptr and the control block",
   "body": "A `shared_ptr<T>` is **two pointers (16 bytes)**: one to the object, one to a heap **control block** holding:\n\n| Field | Purpose |\n|---|---|\n| strong count (atomic) | number of `shared_ptr` owners; reaching 0 destroys the **object** |\n| weak count (atomic) | number of `weak_ptr`s (+1 while strong > 0); reaching 0 frees the **control block** |\n| deleter, allocator | type-erased, so `shared_ptr<Base>` remembers how to delete the `Derived` |\n| (object storage) | only with `make_shared`: object and counts in **one** allocation |\n\n**In class (Lec-11):** a 1 GB buffer shared between owners, and the reference count traced through calls:\n\n```cpp\nvoid g(std::shared_ptr<int> a) { /* count 3 */ }\nvoid f(std::shared_ptr<int> a) { /* count 2 */ g(a); /* back to 2 */ }\n\nint main() {\n    std::shared_ptr<int> a(new int[N], std::default_delete<int[]>()); // 1\n    f(a);                                   // 2 inside f, 3 inside g; back to 1 after f returns\n    { std::shared_ptr<int> b(a); }          // 2 inside the block\n    // 1 here; at the end of main the count hits 0 and the buffer is freed\n}\n```\n\n(The class comments wrote 4 inside the block and 3 after it; that would only be true if `f`'s copies were still alive. By-value copies die when the function returns, so the real values are 1, 2, 3, 2, 1, 2, 1, checked with `use_count()`.)\n\nAlso note: `shared_ptr<int>(new int[N])` uses `delete`, not `delete[]`: UB. Use `shared_ptr<int[]>` (C++17) or pass `std::default_delete<int[]>()`.\n\n**The two-control-block trap** (also from the class notes, \"x(1gb ptr); y(1gb ptr); clean up when both are deleted\"):\n\n```cpp\nint* raw = new int[N];\nstd::shared_ptr<int[]> x(raw);\nstd::shared_ptr<int[]> y(raw);   // BUG: a SECOND control block, count 1 each\n// both reach 0 independently -> delete[] runs twice (double free, UB)\nstd::shared_ptr<int[]> y2(x);    // correct: copy from an existing owner, count 2\n```\n\nRule: create the first owner from `new` (or better `make_shared`) **once**, then copy that `shared_ptr`.\n\nCosts:\n- Copy = atomic increment (`lock xadd`), destroy = atomic decrement: ~5–20 ns uncontended; with threads on different cores sharing the count, the cache line bounces (MESI) and it gets far worse.\n- Moving a `shared_ptr` doesn't touch the count (just steals two pointers).\n- `make_shared`: 1 allocation and better locality, but the object's memory isn't freed until the last `weak_ptr` dies too. `shared_ptr<T>(new T)`: 2 allocations.\n- The count is thread-safe; the **pointed-to object is not**."
  },
  {
   "heading": "A minimal SharedPtr with a control block",
   "body": "The class sketch (`shared_ptr(const shared_ptr& other) { ptr = other.ptr; /* refcount++ */ }`) needed a place to keep a count that **all copies share**. A member `int refcount` would be per-copy, so the count must live on the heap in a control block:\n\n```cpp\ntemplate <typename T>\nclass SharedPtr {\n    struct ControlBlock { std::atomic<long> strong{1}; };\n    T*            ptr_ = nullptr;\n    ControlBlock* cb_  = nullptr;\n\n    void release() noexcept {\n        if (cb_ && cb_->strong.fetch_sub(1, std::memory_order_acq_rel) == 1) {\n            delete ptr_;          // last owner destroys the object\n            delete cb_;           // (no weak_ptr support in this sketch)\n        }\n    }\npublic:\n    SharedPtr() = default;\n    explicit SharedPtr(T* p) : ptr_(p), cb_(p ? new ControlBlock : nullptr) {}\n    SharedPtr(const SharedPtr& o) noexcept : ptr_(o.ptr_), cb_(o.cb_) {\n        if (cb_) cb_->strong.fetch_add(1, std::memory_order_relaxed);   // share + count\n    }\n    SharedPtr(SharedPtr&& o) noexcept                                    // no count change\n        : ptr_(std::exchange(o.ptr_, nullptr)), cb_(std::exchange(o.cb_, nullptr)) {}\n    SharedPtr& operator=(SharedPtr o) noexcept {                         // copy/move-and-swap\n        std::swap(ptr_, o.ptr_); std::swap(cb_, o.cb_);\n        return *this;                                                    // o releases the old one\n    }\n    ~SharedPtr() { release(); }\n    long use_count() const noexcept { return cb_ ? cb_->strong.load(std::memory_order_relaxed) : 0; }\n    T* operator->() const noexcept { return ptr_; }\n    T& operator*()  const noexcept { return *ptr_; }\n};\n```\n\nWhy those memory orders: incrementing needs no ordering (you already hold a reference, so the object can't die). The decrement uses **acq_rel**, so all writes made by other owners happen-before the `delete` performed by whichever thread drops the last reference. That's exactly what libstdc++/libc++ do."
  },
  {
   "heading": "weak_ptr, cycles and enable_shared_from_this",
   "body": "**Reference cycles leak:**\n\n```cpp\nstruct Node { std::shared_ptr<Node> next; ~Node() { std::cout << \"~Node \"; } };\n{\n    auto a = std::make_shared<Node>(), b = std::make_shared<Node>();\n    a->next = b; b->next = a;      // each keeps the other's count at >= 1\n}                                  // no \"~Node\" is printed: both leak\n```\n\nFix: make one direction a **`std::weak_ptr`**, a non-owning observer that points at the control block and doesn't raise the strong count. To use it, `lock()` it, which returns a `shared_ptr` (empty if the object is gone):\n\n```cpp\nstd::weak_ptr<Session> w = sessionPtr;\nif (auto s = w.lock()) s->send(msg);   // safe: s keeps it alive during the call\nw.expired();                           // true once the strong count is 0\n```\n\nTypical uses: parent/back pointers in trees, caches, observers/subscribers (a market data feed holding weak references to strategies).\n\n**`enable_shared_from_this`:** inside a member function, `std::shared_ptr<T>(this)` would create a second control block (the double-free trap). Derive from `std::enable_shared_from_this<T>` and call `shared_from_this()` to get a `shared_ptr` sharing the existing block (the object must already be owned by a `shared_ptr`)."
  },
  {
   "heading": "Smart pointers on the hot path: guidelines",
   "body": "How to pass them (Herb Sutter's guidelines):\n\n| Signature | Meaning |\n|---|---|\n| `void f(Order&)` / `const Order&` / `Order*` | uses the object, doesn't care about ownership: **preferred** on the hot path |\n| `void f(std::unique_ptr<Order> p)` | **takes ownership** (caller must `std::move`) |\n| `void f(std::unique_ptr<Order>& p)` | may reseat/reset the caller's pointer |\n| `void f(std::shared_ptr<Order> p)` | **shares ownership** (keeps a copy): costs an atomic inc/dec |\n| `void f(const std::shared_ptr<Order>& p)` | might take a copy; no count change for the call itself |\n\nHFT rules of thumb:\n- Ownership decided at **startup**, not per message: pre-allocate pools and arenas, then hand out raw pointers or references on the hot path.\n- Prefer values and `unique_ptr`; reach for `shared_ptr` only for genuinely shared lifetimes (sessions, config snapshots), and don't copy it per tick.\n- Every `shared_ptr` copy is an atomic RMW on a shared cache line; two cores copying the same pointer ping-pong that line (~50–100+ ns each under contention).\n- `make_shared`/`make_unique` still call the allocator: a heap allocation is ~20–100 ns typical, with long tails, so do it off the hot path or use a pool with a custom deleter.\n- Smart pointers add indirection: a `vector<unique_ptr<Order>>` scatters orders over the heap (a cache miss per element, ~60–100 ns from DRAM). A `vector<Order>` is contiguous and prefetch-friendly. Store values when you can."
  },
  {
   "heading": "Quick revision",
   "body": "- RAII: acquire in the constructor, release in the destructor; destructors run at scope exit (also during exception unwinding).\n- In class: `new Person` in `f()` never printed its destructor (leak); the stack `Person` did.\n- Rule of 0 first; write the special members only for raw resources; never just a destructor (it kills implicit moves).\n- Move ctor: steal + null the source + `noexcept`. Move assignment: self-check, free old, steal, null source.\n- `std::exchange(x, nullptr)` = take and reset in one expression.\n- Sink parameters: by value + `std::move`; `emplace_back`/`try_emplace` construct in place; `reserve` avoids reallocation moves.\n- Ref-qualified getters (`&&` overload) move out of expiring objects.\n- `vector` reallocation moves only with a `noexcept` move ctor; otherwise it copies.\n- Moving a container is O(1), except `std::array` (O(n)).\n- Moved-from = valid but unspecified; moved-from `unique_ptr` is null.\n- Class SmartPointer bugs: `delete p` vs `ptr`, `delete` vs `delete[]`, implicit copy means double free.\n- `unique_ptr`: 8 bytes, move-only, `make_unique`, `unique_ptr<T[]>`, custom deleter may make it 16 bytes.\n- `shared_ptr`: 16 bytes + control block (strong, weak, deleter); copy = atomic increment; move = no count change.\n- By-value `shared_ptr` parameters raise the count only while the call is running.\n- Two `shared_ptr`s built from the same raw pointer = two control blocks = double delete.\n- `make_shared` = one allocation; memory is held until the weak count is 0 too.\n- `weak_ptr` breaks cycles; `lock()` to use it; `enable_shared_from_this` to get `shared_ptr` from `this`.\n- Hot path: pass `T&`/`T*`; no `shared_ptr` copies per tick; pools + custom deleters."
  },
  {
   "heading": "Exam traps",
   "body": "- `std::unique_ptr<int> p(new int[10]);` compiles but calls `delete`, not `delete[]`: UB. Use `unique_ptr<int[]>`.\n- `std::shared_ptr<int> s(new int[10]);` has the same bug (use `shared_ptr<int[]>` in C++17).\n- `auto q = p;` with a `unique_ptr` doesn't compile (copy is deleted); `auto q = std::move(p);` works and nulls `p`.\n- `p.release()` does **not** free memory; it hands ownership back to you (leak if ignored). `reset()` frees.\n- Two `shared_ptr`s from one raw pointer, or `shared_ptr<T>(this)`: double delete.\n- `shared_ptr` by value into a function: the count goes up during the call and back down after; it's **not** permanent.\n- `make_shared` with a long-lived `weak_ptr`: the object is destroyed at strong = 0 but its memory stays allocated until weak = 0.\n- `std::move` of a `const unique_ptr` doesn't compile (no copy constructor to fall back on), unlike a const string, which silently copies.\n- `use_count()` is approximate in multithreaded code; never use it for synchronisation.\n- Custom deleter type is part of `unique_ptr`'s **type** but not of `shared_ptr`'s (type-erased in the control block).\n- A class with a user-declared destructor still *compiles* with `std::move`, it just copies: check with `static_assert(std::is_nothrow_move_constructible_v<T>)`.\n- `vector<unique_ptr<T>>` can't be copied, only moved; `std::array<T, N>` moves elementwise in O(N)."
  }
 ],
 "keyTerms": [
  {
   "term": "RAII",
   "def": "Resource Acquisition Is Initialisation: the constructor acquires, the destructor releases, tied to scope."
  },
  {
   "term": "Rule of zero",
   "def": "Let members (string, vector, unique_ptr) manage resources so no special members are written."
  },
  {
   "term": "Sink parameter",
   "def": "A parameter taken by value and moved into storage: 1 copy for lvalues, 0 for rvalues."
  },
  {
   "term": "emplace_back",
   "def": "Constructs an element in place from constructor arguments, avoiding a temporary."
  },
  {
   "term": "std::exchange",
   "def": "Replaces an object's value and returns the old one; idiomatic for 'steal and null'."
  },
  {
   "term": "Ref-qualified member function",
   "def": "A member overload selected by the object's value category (`f() &` vs `f() &&`)."
  },
  {
   "term": "Moved-from state",
   "def": "Valid but unspecified state of an object after its resources were moved out."
  },
  {
   "term": "std::unique_ptr",
   "def": "Move-only smart pointer with sole ownership; 8 bytes with the default deleter."
  },
  {
   "term": "Custom deleter",
   "def": "Callable a smart pointer uses instead of delete, e.g. returning an object to a pool."
  },
  {
   "term": "std::shared_ptr",
   "def": "Reference-counted shared-ownership pointer: object pointer + control-block pointer (16 bytes)."
  },
  {
   "term": "Control block",
   "def": "Heap record with the strong count, weak count, deleter and allocator for shared_ptr."
  },
  {
   "term": "Strong count",
   "def": "Number of shared_ptr owners; when it hits 0 the managed object is destroyed."
  },
  {
   "term": "Weak count",
   "def": "Number of weak_ptrs (+1 while owners exist); when it hits 0 the control block is freed."
  },
  {
   "term": "make_shared",
   "def": "Allocates the object and control block in one allocation."
  },
  {
   "term": "std::weak_ptr",
   "def": "Non-owning observer of a shared_ptr's object; `lock()` gives a shared_ptr if it's still alive."
  },
  {
   "term": "enable_shared_from_this",
   "def": "Base class that lets an object obtain a shared_ptr to itself sharing the existing control block."
  },
  {
   "term": "Double free",
   "def": "Releasing the same memory twice: UB, typically from two owners of one pointer."
  }
 ],
 "mcqs": [
  {
   "q": "In class, `void f() { Person* p = new Person(1, 12, 0); }` with `~Person()` printing \"1 Person delete\". What does calling `f()` print?",
   "options": [
    "1 Person delete",
    "Nothing: the heap Person is never destroyed (a leak)",
    "It crashes at the end of f",
    "1 Person delete, printed twice"
   ],
   "answer": 1,
   "explanation": "Only the pointer is destroyed at scope exit; the heap object has no owner, so its destructor never runs. C++ has no garbage collector.",
   "distractors": "The stack version `Person person{1,12,0};` is the one that prints at the closing brace.",
   "source": "lecture",
   "id": "L07-m1"
  },
  {
   "q": "What is wrong with the class sketch `template<class T> class SmartPointer { public: SmartPointer(T* p) : ptr(p) {} ~SmartPointer() { delete p; } T* ptr; };`?",
   "options": [
    "Nothing",
    "It should use free() instead of delete",
    "Templates can't have destructors",
    "`p` is not in scope in the destructor (must be `ptr`), and copying it would cause a double free"
   ],
   "answer": 3,
   "explanation": "The destructor refers to the constructor's parameter (a compile error) and the implicit copy constructor duplicates ownership, so two destructors free the same memory.",
   "distractors": "free() must never be paired with new; templates can have destructors like any class.",
   "source": "lecture",
   "id": "L07-m2"
  },
  {
   "q": "`SmartPointer<int> obj(new int[1000]);` with a destructor doing `delete ptr;`. What's the problem?",
   "options": [
    "Memory from new[] must be freed with delete[]: using delete is UB",
    "No problem",
    "It leaks 999 ints but frees the first",
    "It's a compile error"
   ],
   "answer": 0,
   "explanation": "Array new must be paired with delete[]; mismatching them is UB (the runtime may not run destructors or may corrupt the heap).",
   "distractors": "It compiles, and 'leaks 999' describes one possible symptom, not a guarantee.",
   "source": "lecture",
   "id": "L07-m3"
  },
  {
   "q": "What is `sizeof(std::unique_ptr<Order>)` on x86-64 with the default deleter?",
   "options": [
    "16",
    "24",
    "8",
    "0"
   ],
   "answer": 2,
   "explanation": "The default deleter is an empty type folded away by empty-base optimisation, so the unique_ptr is just one pointer.",
   "distractors": "16 is shared_ptr (two pointers) or a unique_ptr with a function-pointer deleter.",
   "source": "lecture",
   "id": "L07-m4"
  },
  {
   "q": "What is `sizeof(std::unique_ptr<FILE, int(*)(FILE*)>)` on x86-64?",
   "options": [
    "8",
    "24",
    "16",
    "4"
   ],
   "answer": 2,
   "explanation": "A function-pointer deleter has to be stored: pointer (8) plus function pointer (8). A stateless lambda deleter would keep it at 8.",
   "distractors": "Only empty deleter types are free.",
   "source": "lecture",
   "id": "L07-m5"
  },
  {
   "q": "Which line fails to compile?\n    auto p = std::make_unique<Order>();",
   "options": [
    "`auto q = p;`",
    "`auto q = std::move(p);`",
    "`Order* raw = p.get();`",
    "`p.reset();`"
   ],
   "answer": 0,
   "explanation": "unique_ptr's copy constructor is deleted because it's a sole owner; ownership can only be transferred by move.",
   "distractors": "Moving, get() and reset() are all valid.",
   "source": "lecture",
   "id": "L07-m6"
  },
  {
   "q": "What does `p.release()` do on a `std::unique_ptr<Order> p`?",
   "options": [
    "Deletes the Order and nulls p",
    "Moves the Order to the stack",
    "Decrements a reference count",
    "Returns the raw pointer and nulls p without deleting: the caller now owns it"
   ],
   "answer": 3,
   "explanation": "release() gives up ownership and hands back the pointer; if you ignore the return value, the object leaks.",
   "distractors": "reset() is the one that deletes; unique_ptr has no reference count.",
   "source": "lecture",
   "id": "L07-m7"
  },
  {
   "q": "In the class trace, with by-value `f(shared_ptr<int> a)` calling by-value `g(a)`: what is `use_count()` inside `g`, and back in `main` after `f` returns?",
   "options": [
    "3, then 3",
    "3, then 1",
    "2, then 2",
    "4, then 3"
   ],
   "answer": 1,
   "explanation": "main owns 1, f's parameter makes 2, g's makes 3; both parameters are destroyed when the functions return, so it's back to 1.",
   "distractors": "The counts drop when by-value parameters go out of scope; they don't accumulate.",
   "source": "lecture",
   "id": "L07-m8"
  },
  {
   "q": "What happens here?\n    int* raw = new int[100];\n    std::shared_ptr<int[]> x(raw);\n    std::shared_ptr<int[]> y(raw);",
   "options": [
    "x and y share one control block with count 2",
    "Two control blocks with count 1 each: delete[] runs twice, which is UB",
    "Memory is freed once, when both are gone",
    "Compile error"
   ],
   "answer": 1,
   "explanation": "Each constructor from a raw pointer makes a new control block, so each thinks it's the sole owner and both delete the buffer.",
   "distractors": "To share, copy-construct y from x.",
   "source": "lecture",
   "id": "L07-m9"
  },
  {
   "q": "What does copying a `std::shared_ptr` cost at the machine level?",
   "options": [
    "Nothing: it's a pointer copy",
    "A mutex lock and unlock",
    "A heap allocation",
    "An atomic increment of the strong count in the control block (a locked RMW)"
   ],
   "answer": 3,
   "explanation": "Copying copies two pointers and does an atomic fetch_add on the shared count; destruction does an atomic decrement.",
   "distractors": "No allocation or mutex is involved, but it isn't free like a raw pointer copy.",
   "source": "lecture",
   "id": "L07-m10"
  },
  {
   "q": "What does moving a `std::shared_ptr` (`auto b = std::move(a);`) do to the strong count?",
   "options": [
    "Leaves it unchanged",
    "Decrements it",
    "Increments it",
    "Resets it to 1"
   ],
   "answer": 0,
   "explanation": "A move transfers both pointers and nulls the source; the number of owners stays the same, so no atomic op is needed.",
   "distractors": "Only copies and destructions change the count.",
   "source": "lecture",
   "id": "L07-m11"
  },
  {
   "q": "What is the main advantage of `std::make_shared<T>(args)` over `std::shared_ptr<T>(new T(args))`?",
   "options": [
    "The object is placed on the stack",
    "The object is thread-safe",
    "One allocation for object and control block instead of two, with better cache locality",
    "No reference counting is needed"
   ],
   "answer": 2,
   "explanation": "make_shared allocates a single block holding the counts and the object, saving an allocation and keeping them adjacent.",
   "distractors": "It's still heap memory and still counted, and it gives no thread safety for the object.",
   "source": "lecture",
   "id": "L07-m12"
  },
  {
   "q": "Two objects hold `std::shared_ptr`s to each other and nothing else refers to them. What happens when the last outside owner goes away?",
   "options": [
    "Both destructors run",
    "The runtime's cycle collector frees them",
    "Neither is destroyed: each keeps the other's count at 1, so they leak",
    "Undefined behaviour"
   ],
   "answer": 2,
   "explanation": "Reference counting can't reclaim cycles; break one link with a weak_ptr.",
   "distractors": "C++ has no cycle collector, and a leak is well-defined behaviour, not UB.",
   "source": "lecture",
   "id": "L07-m13"
  },
  {
   "q": "How do you safely use the object a `std::weak_ptr<Session> w` refers to?",
   "options": [
    "`if (auto s = w.lock()) s->send();`",
    "`*w`",
    "`w->send()`",
    "`w.get()->send()`"
   ],
   "answer": 0,
   "explanation": "weak_ptr has no -> or get(); lock() atomically produces a shared_ptr (empty if the object is gone) that keeps it alive during use.",
   "distractors": "Direct access isn't offered because the object might be destroyed concurrently.",
   "source": "lecture",
   "id": "L07-m14"
  },
  {
   "q": "Inside a member function of a class already owned by a `shared_ptr`, you need a `shared_ptr` to `this`. What is correct?",
   "options": [
    "`return std::shared_ptr<T>(this);`",
    "`return std::shared_ptr<T>(std::move(this));`",
    "`return std::make_shared<T>(*this);`",
    "Derive from `std::enable_shared_from_this<T>` and call `shared_from_this()`"
   ],
   "answer": 3,
   "explanation": "shared_from_this() reuses the existing control block, so the count is shared correctly.",
   "distractors": "Wrapping `this` creates a second control block (double delete); make_shared(*this) makes a copy of the object.",
   "source": "lecture",
   "id": "L07-m15"
  },
  {
   "q": "`std::vector<Tracer> v;` then 5 times `v.push_back(Tracer{});`, with a noexcept move ctor and no `reserve`, capacity growing 1, 2, 4, 8. How many moves and copies?",
   "options": [
    "5 copies, 0 moves",
    "0 copies, 12 moves",
    "0 copies, 5 moves",
    "7 copies, 5 moves"
   ],
   "answer": 1,
   "explanation": "5 moves for the pushes plus 1 + 2 + 4 moves when reallocating at capacities 1, 2 and 4: 12 moves and no copies.",
   "distractors": "Without noexcept the 7 reallocation moves would become copies.",
   "source": "lecture",
   "id": "L07-m16"
  },
  {
   "q": "Which is the cheapest way to add an `Order` built from `(id, px, qty)` to a pre-reserved vector?",
   "options": [
    "`v.push_back(Order(id, px, qty));`",
    "`v.emplace_back(id, px, qty);`",
    "`Order o(id, px, qty); v.push_back(o);`",
    "`v.insert(v.begin(), Order(id, px, qty));`"
   ],
   "answer": 1,
   "explanation": "emplace_back constructs the element directly in the vector's storage: no temporary, copy or move.",
   "distractors": "push_back of a temporary costs an extra move, of a named object a copy; inserting at the front shifts every element (O(n)).",
   "source": "lecture",
   "id": "L07-m17"
  },
  {
   "q": "Given `struct Order { std::string sym; const std::string& symbol() const & { return sym; } std::string symbol() && { return std::move(sym); } };`, what happens with `std::string s = makeOrder().symbol();`?",
   "options": [
    "Returns a dangling reference",
    "The string is copied (the const & overload)",
    "Compile error: ambiguous",
    "The string is moved out of the temporary Order (the && overload)"
   ],
   "answer": 3,
   "explanation": "makeOrder() is a prvalue, so the rvalue-qualified overload is chosen and steals sym from the dying object.",
   "distractors": "Ref-qualifiers make the overloads distinct; the const& version would only be picked for lvalues.",
   "source": "lecture",
   "id": "L07-m18"
  },
  {
   "q": "What is the complexity of `auto w = std::move(v);` for `std::vector<Order> v` vs `std::array<Order, 1000> a` moved the same way?",
   "options": [
    "O(1) for vector, O(n) for array",
    "O(n) for both",
    "O(n) for vector, O(1) for array",
    "O(1) for both"
   ],
   "answer": 0,
   "explanation": "vector moves by stealing its heap buffer (three pointers); std::array stores elements inline, so each one must be moved individually.",
   "distractors": "The array has no heap buffer to steal.",
   "source": "lecture",
   "id": "L07-m19"
  },
  {
   "q": "Why should hot-path functions usually take `const Order&` rather than `std::shared_ptr<Order>` by value?",
   "options": [
    "shared_ptr can't be passed by value",
    "References are bigger than pointers",
    "A by-value shared_ptr costs an atomic increment and decrement per call (and cache-line contention across threads)",
    "shared_ptr calls a virtual function on every access"
   ],
   "answer": 2,
   "explanation": "If the function doesn't take ownership, the refcount traffic is pure overhead; the caller's owner keeps the object alive.",
   "distractors": "Passing shared_ptr by value is legal, and its dereference is not virtual.",
   "source": "lecture",
   "id": "L07-m20"
  },
  {
   "q": "Which is the correct C++17 way to own a heap array of 1000 ints with shared ownership?",
   "options": [
    "`std::shared_ptr<int> p(new int[1000]);`",
    "`std::shared_ptr<int> p = std::make_shared<int>(1000);`",
    "`std::shared_ptr<int[]> p(new int[1000]);`",
    "`std::shared_ptr<int*> p(new int[1000]);`"
   ],
   "answer": 2,
   "explanation": "shared_ptr<int[]> (C++17) uses delete[] and supports operator[].",
   "distractors": "shared_ptr<int> with new[] calls delete (UB); make_shared<int>(1000) makes a single int with value 1000; shared_ptr<int*> doesn't compile from int*.",
   "source": "lecture",
   "id": "L07-m21"
  },
  {
   "q": "In a move assignment operator, why must you `delete[]` the current buffer before stealing the other's?",
   "options": [
    "Otherwise the old buffer leaks",
    "Otherwise the other object leaks",
    "The standard requires it to be noexcept",
    "To trigger NRVO"
   ],
   "answer": 0,
   "explanation": "The left-hand object already owns a resource; overwriting its pointer without freeing loses that memory.",
   "distractors": "The source's buffer is transferred, not lost; noexcept and NRVO are unrelated.",
   "source": "lecture",
   "id": "L07-m22"
  }
 ],
 "msqs": [
  {
   "q": "Which statements about RAII are true? (select all that apply)",
   "options": [
    "RAII needs a garbage collector",
    "Smart pointers, std::lock_guard and std::fstream are RAII types",
    "Destructors run during stack unwinding when an exception propagates",
    "A raw owning pointer going out of scope frees its object",
    "Destructors run automatically at scope exit"
   ],
   "answers": [
    1,
    2,
    4
   ],
   "explanation": "RAII relies on deterministic destructors at scope exit and during unwinding, and the standard library is full of RAII types. A raw pointer's own destruction frees nothing, and C++ has no GC.",
   "id": "L07-x1"
  },
  {
   "q": "Which bugs are in the class sketch `SmartPointer(T* p) : ptr(p) {}  ~SmartPointer() { delete p; }` used as `SmartPointer obj(new int[1000]);`? (select all that apply)",
   "options": [
    "The destructor uses `p`, which is out of scope",
    "The constructor should be explicit",
    "The implicit copy constructor allows a double free",
    "It allocates on the stack",
    "`delete` instead of `delete[]` for an array"
   ],
   "answers": [
    0,
    1,
    2,
    4
   ],
   "explanation": "All four are real defects of the sketch. It doesn't allocate on the stack: the int array is on the heap and only the wrapper object lives on the stack.",
   "id": "L07-x2"
  },
  {
   "q": "Which are properties of `std::unique_ptr<T>` with the default deleter? (select all that apply)",
   "options": [
    "Calls delete[] automatically for `unique_ptr<T[]>`",
    "Copyable",
    "Same size as a raw pointer",
    "Uses an atomic reference count",
    "Movable; the source becomes null"
   ],
   "answers": [
    0,
    2,
    4
   ],
   "explanation": "unique_ptr is 8 bytes, move-only (null after a move) and has an array specialisation with delete[]. It can't be copied and has no reference count.",
   "id": "L07-x3"
  },
  {
   "q": "What does a shared_ptr control block contain? (select all that apply)",
   "options": [
    "The deleter (type-erased)",
    "The object itself, when created with make_shared",
    "The strong (owner) count",
    "A mutex protecting the object",
    "The weak count"
   ],
   "answers": [
    0,
    1,
    2,
    4
   ],
   "explanation": "The control block stores both counts, the deleter/allocator and, with make_shared, the object. There's no mutex: the counts are atomics, and the object isn't protected.",
   "id": "L07-x4"
  },
  {
   "q": "Which of these lead to a double delete or UB? (select all that apply)",
   "options": [
    "Moving a unique_ptr into a vector",
    "Copying a hand-written owner class that has no user-defined copy constructor",
    "Copy-constructing a shared_ptr from another shared_ptr",
    "`std::shared_ptr<T>(this)` inside a member of an object already owned by a shared_ptr",
    "Two shared_ptrs constructed from the same raw pointer"
   ],
   "answers": [
    1,
    3,
    4
   ],
   "explanation": "Separate control blocks and implicit shallow copies give two owners for one pointer. Copying a shared_ptr shares the block, and moving a unique_ptr transfers ownership safely.",
   "id": "L07-x5"
  },
  {
   "q": "Which operations change a shared_ptr's strong count? (select all that apply)",
   "options": [
    "Destroying a non-empty shared_ptr",
    "Move-constructing a shared_ptr",
    "Copy-constructing a shared_ptr",
    "Creating a weak_ptr from it",
    "Successful `weak_ptr::lock()`"
   ],
   "answers": [
    0,
    2,
    4
   ],
   "explanation": "Copies and successful lock() add an owner; destruction removes one. Moves transfer ownership without changing the count, and weak_ptr only touches the weak count.",
   "id": "L07-x6"
  },
  {
   "q": "Which correctly describe weak_ptr? (select all that apply)",
   "options": [
    "It breaks shared_ptr reference cycles",
    "It keeps the control block alive",
    "You dereference it directly with ->",
    "`lock()` returns an empty shared_ptr if the object is gone",
    "It doesn't keep the object alive"
   ],
   "answers": [
    0,
    1,
    3,
    4
   ],
   "explanation": "weak_ptr is a non-owning observer that keeps only the control block alive and needs lock() to access the object. It has no operator->.",
   "id": "L07-x7"
  },
  {
   "q": "Which reduce copies when filling and using a `std::vector<Order>`? (select all that apply)",
   "options": [
    "`push_back(std::move(o))` on the last use of `o`",
    "Declaring only a destructor in Order",
    "`reserve()` with the expected size",
    "Marking Order's move constructor noexcept",
    "`emplace_back(id, px, qty)`"
   ],
   "answers": [
    0,
    2,
    3,
    4
   ],
   "explanation": "Reserve avoids reallocations, emplace constructs in place, noexcept enables moves on growth, and std::move on last use moves. Declaring only a destructor suppresses the implicit moves, which adds copies.",
   "id": "L07-x8"
  },
  {
   "q": "A correct move assignment `T& operator=(T&& o) noexcept` for a class owning `data_` should: (select all that apply)",
   "options": [
    "Return *this",
    "Guard against self-move",
    "Allocate a new buffer and copy o's contents",
    "Free the current `data_`",
    "Take `o.data_` and set `o.data_ = nullptr`"
   ],
   "answers": [
    0,
    1,
    3,
    4
   ],
   "explanation": "Move assignment releases its old resource, steals the source's, nulls the source, handles self-move and returns *this. Allocating and copying is what copy assignment does.",
   "id": "L07-x9"
  },
  {
   "q": "Which statements about moved-from objects are true? (select all that apply)",
   "options": [
    "A moved-from std::unique_ptr is guaranteed to be null",
    "Reading a moved-from std::vector's size is UB",
    "std::move of a const std::string moves it anyway",
    "A moved-from std::string is valid but its value is unspecified",
    "You may assign a new value to a moved-from object"
   ],
   "answers": [
    0,
    3,
    4
   ],
   "explanation": "unique_ptr is null after a move, standard types are valid but unspecified, and assignment is always allowed. size() on a moved-from vector is fine (no preconditions), and moving a const string copies it.",
   "id": "L07-x10"
  },
  {
   "q": "For HFT hot-path code, which are good practices? (select all that apply)",
   "options": [
    "Copy a shared_ptr into every message handler call",
    "Call make_shared for each incoming tick",
    "Pass `const Order&` or `Order*` when the function doesn't take ownership",
    "Prefer `vector<Order>` over `vector<unique_ptr<Order>>` for iteration-heavy data",
    "Allocate objects from a pre-allocated pool, with a custom deleter returning them"
   ],
   "answers": [
    2,
    3,
    4
   ],
   "explanation": "Borrowing by reference, pooling and contiguous storage keep latency low. Per-call shared_ptr copies cost atomics, and per-tick make_shared means per-tick heap allocation.",
   "id": "L07-x11"
  },
  {
   "q": "Which are true about custom deleters? (select all that apply)",
   "options": [
    "For shared_ptr, the deleter is type-erased in the control block",
    "A function-pointer deleter keeps unique_ptr at 8 bytes",
    "A stateless lambda deleter keeps unique_ptr at 8 bytes",
    "For unique_ptr, the deleter type is part of the pointer's type",
    "Custom deleters can return objects to a pool instead of calling delete"
   ],
   "answers": [
    0,
    2,
    3,
    4
   ],
   "explanation": "unique_ptr<T, D> carries D in its type (an empty D costs nothing), shared_ptr hides it in the control block, and pools commonly use deleters. A function pointer must be stored, making it 16 bytes.",
   "id": "L07-x12"
  },
  {
   "q": "Which container moves are O(1)? (select all that apply)",
   "options": [
    "Moving a std::array<int, 1000>",
    "Moving a std::list",
    "Moving a std::string longer than the SSO capacity",
    "Moving a std::map",
    "Moving a std::vector"
   ],
   "answers": [
    1,
    2,
    3,
    4
   ],
   "explanation": "Heap-based containers and long strings move by transferring pointers. std::array stores its elements inline, so moving it moves each element: O(n).",
   "id": "L07-x13"
  }
 ],
 "short": [
  {
   "q": "Fix the class `SmartPointer` from our smart-pointer lesson (`SmartPointer(T* p) : ptr(p) {}  ~SmartPointer() { delete p; }  T* ptr;`) so it's a correct unique owner. Write the code and explain each change.",
   "checks": [
    {
     "label": "Destructor deletes ptr (not p)",
     "patterns": [
      "delete\\s+ptr",
      "delete\\s+ptr_"
     ]
    },
    {
     "label": "Copy operations deleted",
     "patterns": [
      "=\\s*delete"
     ]
    },
    {
     "label": "Move constructor that nulls the source",
     "patterns": [
      "&&[\\s\\S]{0,120}nullptr",
      "exchange\\s*\\([\\s\\S]{0,30}nullptr"
     ]
    },
    {
     "label": "noexcept moves",
     "patterns": [
      "noexcept"
     ]
    },
    {
     "label": "Mentions double free / delete[] for arrays",
     "patterns": [
      "double (free|delete)",
      "delete\\s*\\[\\s*\\]"
     ]
    }
   ],
   "modelAnswer": "```cpp\ntemplate <typename T>\nclass SmartPointer {\n    T* ptr = nullptr;\npublic:\n    explicit SmartPointer(T* p) noexcept : ptr(p) {}          // explicit: no implicit T* conversion\n    ~SmartPointer() { delete ptr; }                           // was `delete p` (out of scope)\n\n    SmartPointer(const SmartPointer&) = delete;               // a copy would mean two owners,\n    SmartPointer& operator=(const SmartPointer&) = delete;    // i.e. a double free\n\n    SmartPointer(SmartPointer&& o) noexcept : ptr(std::exchange(o.ptr, nullptr)) {}\n    SmartPointer& operator=(SmartPointer&& o) noexcept {\n        if (this != &o) { delete ptr; ptr = std::exchange(o.ptr, nullptr); }\n        return *this;\n    }\n    T& operator*()  const { return *ptr; }\n    T* operator->() const { return ptr; }\n    T* get() const { return ptr; }\n};\n```\n\nChanges: (1) the destructor must delete the member `ptr`; (2) copying is deleted because two copies would both delete the same pointer (a **double free**); (3) moves transfer ownership and null the source, and they're `noexcept` so containers can move them; (4) for `new int[1000]`, add a `SmartPointer<T[]>` partial specialisation whose destructor uses `delete[]`, since plain `delete` on an array is UB. This is essentially `std::unique_ptr`.",
   "explanation": "They want the scope fix, deleted copies, a nulling move and the array delete[] point.",
   "id": "L07-s1"
  },
  {
   "q": "Explain the shared_ptr control block: what it stores, when the object and the block are freed, and why make_shared is faster.",
   "checks": [
    {
     "label": "Strong count",
     "patterns": [
      "strong"
     ]
    },
    {
     "label": "Weak count",
     "patterns": [
      "weak"
     ]
    },
    {
     "label": "Deleter stored",
     "patterns": [
      "deleter"
     ]
    },
    {
     "label": "Object destroyed at strong 0, block freed at weak 0",
     "patterns": [
      "strong[\\s\\S]{0,80}(0|zero)[\\s\\S]{0,80}(destroy|delete)",
      "(destroy|delete)[\\s\\S]{0,80}strong[\\s\\S]{0,40}(0|zero)"
     ]
    },
    {
     "label": "make_shared: one allocation",
     "patterns": [
      "(one|single) allocation",
      "one heap allocation",
      "allocates once"
     ]
    }
   ],
   "modelAnswer": "A `shared_ptr<T>` holds two pointers: to the object and to a heap **control block**. The block stores the **strong count** (number of `shared_ptr` owners), the **weak count** (number of `weak_ptr`s, plus one while any owner exists), the type-erased **deleter** and allocator, and with `make_shared`, the object itself.\n\nWhen the strong count reaches 0, the object is destroyed (the deleter runs). When the weak count also reaches 0, the control block is deallocated, so `weak_ptr::lock()` can still safely check for expiry in between.\n\nCopying a `shared_ptr` is an atomic increment and destroying one an atomic decrement (5–20 ns uncontended, worse when cores share the line); moving changes nothing.\n\n`make_shared` does **one allocation** for object + control block instead of two (`new T` plus a block), so there's less allocator time and the counts sit next to the object in cache. The trade-off: with outstanding `weak_ptr`s, the object's memory isn't returned until the weak count hits 0.",
   "explanation": "Name the fields, the two lifetimes and the single allocation.",
   "id": "L07-s2"
  },
  {
   "q": "Trace `use_count()` at each commented point and explain:\n    void g(std::shared_ptr<int> a) { /* A */ }\n    void f(std::shared_ptr<int> a) { /* B */ g(a); /* C */ }\n    int main() {\n      auto p = std::make_shared<int>(5);   /* D */\n      f(p);                                /* E (after the call) */\n      { auto q = p; /* F */ }\n      /* G */\n    }",
   "checks": [
    {
     "label": "D = 1",
     "patterns": [
      "D\\D{0,10}1\\b"
     ]
    },
    {
     "label": "B = 2 and A = 3",
     "patterns": [
      "B\\D{0,10}2\\b[\\s\\S]{0,250}A\\D{0,10}3\\b",
      "A\\D{0,10}3\\b[\\s\\S]{0,250}B\\D{0,10}2\\b"
     ]
    },
    {
     "label": "C = 2",
     "patterns": [
      "C\\D{0,10}2\\b"
     ]
    },
    {
     "label": "E = 1, F = 2, G = 1",
     "patterns": [
      "E\\D{0,10}1\\b[\\s\\S]{0,250}F\\D{0,10}2\\b[\\s\\S]{0,250}G\\D{0,10}1\\b"
     ]
    },
    {
     "label": "By-value parameters are destroyed on return",
     "patterns": [
      "(destroy|destruct|die|released|go(es)? out of scope)[\\s\\S]{0,80}return",
      "return[\\s\\S]{0,80}(destroy|destruct|decrement)"
     ]
    }
   ],
   "modelAnswer": "- D: 1 (p is the only owner).\n- B: 2 (f's by-value parameter `a` is a copy).\n- A: 3 (g's parameter is another copy).\n- C: 2 (g's parameter is destroyed when g returns, decrementing the count).\n- E: 1 (f's parameter is destroyed when f returns).\n- F: 2 (q is a copy inside the block).\n- G: 1 (q went out of scope at the closing brace).\n\nBy-value `shared_ptr` parameters are copies that are destroyed on return, so they raise the count only for the duration of the call; each copy costs an atomic increment plus a decrement. In class, the comments said 4 inside the block and 3 after it, which assumes the function copies were still alive; they aren't. Passing `const std::shared_ptr<int>&` (or `int&`) avoids the count traffic entirely.",
   "explanation": "Correct numbers at each point, plus the reason the counts drop after each call.",
   "id": "L07-s3"
  },
  {
   "q": "Why does `std::vector<T>` sometimes COPY elements when it grows even though T has a move constructor? How do you fix it, and how would you verify it?",
   "checks": [
    {
     "label": "Strong exception guarantee",
     "patterns": [
      "(strong )?exception (safety )?guarantee",
      "strong guarantee"
     ]
    },
    {
     "label": "move_if_noexcept / move must be noexcept",
     "patterns": [
      "move_if_noexcept",
      "noexcept"
     ]
    },
    {
     "label": "Throwing move could leave elements in a broken state",
     "patterns": [
      "(throw|exception)[\\s\\S]{0,120}(lost|broken|half|partial|both|can't (roll|undo)|cannot (roll|undo))"
     ]
    },
    {
     "label": "Fix: mark move constructor noexcept / default it",
     "patterns": [
      "mark[\\s\\S]{0,40}noexcept",
      "=\\s*default"
     ]
    },
    {
     "label": "Verify with static_assert / counters",
     "patterns": [
      "static_assert",
      "is_nothrow_move_constructible",
      "count"
     ]
    }
   ],
   "modelAnswer": "On reallocation `vector` must give the **strong exception guarantee**: if anything throws, the original vector is unchanged. Copying elements into the new buffer is safe (the old ones are untouched), but if a **move** throws halfway through, some originals have already been gutted and can't be rolled back, leaving things broken. So `vector` uses `std::move_if_noexcept`: it moves only if T's move constructor is **noexcept** (or T isn't copyable at all); otherwise it copies.\n\nFix: mark the move constructor (and move assignment) `noexcept`, or `= default` them in a Rule-of-0 class so the compiler deduces noexcept from the members. Never declare only a destructor, which removes the implicit moves.\n\nVerify: `static_assert(std::is_nothrow_move_constructible_v<T>);`, or instrument T with copy/move counters. Five `push_back`s without `reserve` show 0 copies and 12 moves with noexcept, and 7 copies on reallocation without it.",
   "explanation": "They want the exception-guarantee reasoning, move_if_noexcept, the noexcept fix and a way to check.",
   "id": "L07-s4"
  },
  {
   "q": "Rewrite this to remove unnecessary copies, and explain each change:\n    struct Instrument { std::string sym; Instrument(const std::string& s) { sym = s; } };\n    std::vector<Instrument> load(const std::vector<std::string>& names) {\n      std::vector<Instrument> out;\n      for (auto n : names) out.push_back(Instrument(n));\n      return out;\n    }",
   "checks": [
    {
     "label": "Sink parameter by value + std::move",
     "patterns": [
      "Instrument\\s*\\(\\s*std::string\\s+\\w+\\s*\\)",
      "std::move\\s*\\(\\s*s\\s*\\)"
     ]
    },
    {
     "label": "Member initialiser list instead of assignment",
     "patterns": [
      "initiali[sz]er list",
      ":\\s*sym\\s*\\("
     ]
    },
    {
     "label": "Loop by const reference",
     "patterns": [
      "const\\s+(auto|std::string)\\s*&"
     ]
    },
    {
     "label": "reserve",
     "patterns": [
      "reserve"
     ]
    },
    {
     "label": "emplace_back",
     "patterns": [
      "emplace_back"
     ]
    },
    {
     "label": "Return by value relies on NRVO / no std::move on return",
     "patterns": [
      "NRVO",
      "return out;"
     ]
    }
   ],
   "modelAnswer": "```cpp\nstruct Instrument {\n    std::string sym;\n    explicit Instrument(std::string s) : sym(std::move(s)) {}   // sink: by value + move\n};\n\nstd::vector<Instrument> load(const std::vector<std::string>& names) {\n    std::vector<Instrument> out;\n    out.reserve(names.size());                 // one allocation, no reallocation moves\n    for (const auto& n : names)                // no per-element string copy\n        out.emplace_back(n);                   // construct in place, no temporary Instrument\n    return out;                                // NRVO / implicit move, no std::move here\n}\n```\n\nChanges:\n1. `for (auto n : names)` copied every string; `const auto&` borrows it.\n2. The constructor default-constructed `sym` then copy-assigned it; a member initialiser list with a by-value sink parameter plus `std::move` gives one copy for lvalues and zero for rvalues.\n3. `push_back(Instrument(n))` built a temporary then moved it; `emplace_back(n)` constructs in place.\n4. `reserve` avoids reallocations (each would move every element).\n5. `return out;` is NRVO (or an implicit move); `return std::move(out)` would block NRVO.\n\nNet effect: exactly one string copy per name (unavoidable, since the input is const) and a single vector allocation.",
   "explanation": "Expect the sink idiom, const& loop, reserve, emplace_back, and no std::move on the return.",
   "id": "L07-s5"
  },
  {
   "q": "What is a shared_ptr reference cycle? Show one and fix it.",
   "checks": [
    {
     "label": "Two objects owning each other via shared_ptr",
     "patterns": [
      "each other",
      "cycle"
     ]
    },
    {
     "label": "Counts never reach zero: leak",
     "patterns": [
      "never (reach|hit|drop)",
      "leak"
     ]
    },
    {
     "label": "Fix with weak_ptr",
     "patterns": [
      "weak_ptr"
     ]
    },
    {
     "label": "lock() to access",
     "patterns": [
      "lock\\s*\\(\\s*\\)"
     ]
    }
   ],
   "modelAnswer": "A cycle happens when objects own **each other** through `shared_ptr`:\n\n```cpp\nstruct Node { std::shared_ptr<Node> next; };\nauto a = std::make_shared<Node>(), b = std::make_shared<Node>();\na->next = b; b->next = a;   // when a and b go out of scope, each count is still 1\n```\n\nThe strong counts **never reach** zero, so neither destructor runs: a **leak** (C++ has no cycle collector).\n\nFix: make the back or non-owning link a **`std::weak_ptr`**, which doesn't contribute to the strong count:\n\n```cpp\nstruct Node { std::shared_ptr<Node> next; std::weak_ptr<Node> prev; };\nif (auto p = node->prev.lock()) { /* use p */ }   // lock() gives a shared_ptr or empty\n```\n\nUse `lock()` to get a temporary owner while accessing it. Typical places: parent pointers, observer/subscriber lists, caches.",
   "explanation": "Shows the cycle, the leak, weak_ptr as the fix and lock() for access.",
   "id": "L07-s6"
  },
  {
   "q": "When should hot-path HFT code use `unique_ptr`, `shared_ptr`, or plain references, and what does each cost?",
   "checks": [
    {
     "label": "References/raw pointers for non-owning access",
     "patterns": [
      "(reference|raw pointer|T\\s*&|T\\s*\\*)[\\s\\S]{0,80}(non[- ]owning|borrow|doesn't own|does not own|no ownership)"
     ]
    },
    {
     "label": "unique_ptr is zero overhead / 8 bytes",
     "patterns": [
      "unique_ptr[\\s\\S]{0,120}(zero[- ]overhead|8 bytes|same as a raw pointer)"
     ]
    },
    {
     "label": "shared_ptr copy costs atomic ops",
     "patterns": [
      "shared_ptr[\\s\\S]{0,160}atomic"
     ]
    },
    {
     "label": "Avoid allocation on the hot path / pools",
     "patterns": [
      "pool",
      "pre-?allocat"
     ]
    },
    {
     "label": "Cache-line contention / bouncing",
     "patterns": [
      "cache[- ]line",
      "contention",
      "bounc",
      "ping[- ]pong"
     ]
    }
   ],
   "modelAnswer": "- **Plain references / raw pointers** (`const Order&`, `Order*`) for **non-owning** access: the default for hot-path functions. They cost nothing extra and make it clear the callee doesn't take ownership.\n- **`unique_ptr`** for single ownership: **zero overhead** (8 bytes, same codegen as a raw pointer for `->`); moving it is a pointer copy plus a null store. Use it for objects whose owner is clear, ideally created at startup or drawn from a **pool** with a custom deleter so the hot path never calls `new`.\n- **`shared_ptr`** only for genuinely shared lifetimes (sessions, config snapshots). Each copy or destruction is an **atomic** RMW on the control block (~5–20 ns uncontended). When several cores copy the same pointer, its cache line bounces between them (MESI **contention**), which is far slower. Never copy one per tick; pass it by `const&` or hand out a reference.\n- Ownership through any pointer also costs **indirection**: a `vector<unique_ptr<Order>>` is a cache miss per element, while a contiguous `vector<Order>` prefetches well. Prefer values and pre-allocated storage.",
   "explanation": "Separate ownership from use, quantify costs (atomics, contention, allocation) and recommend pools/references.",
   "id": "L07-s7"
  }
 ],
 "quiz": [],
 "coding": [
  {
   "id": "unique-ptr",
   "title": "UniquePtr with a Custom Deleter"
  },
  {
   "id": "shared-ptr",
   "title": "SharedPtr with an Atomic Control Block"
  }
 ],
 "prev": {
  "num": 6,
  "file": "lecture-06.html"
 },
 "next": {
  "num": 8,
  "file": "lecture-08.html"
 }
};
