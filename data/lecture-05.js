window.PAGE = {
 "num": 5,
 "title": "Templates and Generic Programming",
 "summary": "How C++ moves dispatch from runtime to compile time: function and class templates, how they're instantiated (and what Compiler Explorer shows), auto and Scott Meyers' deduction rules, variadic templates, and specialization interview classics. Then the runtime alternative and its cost: vtables, virtual destructors, the latency of indirection, and CRTP as the first HFT pattern, plus decltype(auto), constexpr/consteval and the four casts.",
 "notes": [
  {
   "heading": "Problem: templatized order posting",
   "body": "The motivating problem: a trading system posts orders to several venues (exchange A, exchange B, a simulator for back-testing). The classic OOP answer is an abstract `Venue` base class with a `virtual void send(const Order&)`. That works, but every send on the hot path pays an **indirect call** and the compiler cannot inline through it.\n\nThe template answer: make the venue a **compile-time parameter**. The compiler stamps out one concrete function per venue type, every call is a direct (usually inlined) call, and a wrong type fails at compile time instead of at runtime.\n\n```cpp\nstruct Order { uint64_t id; int64_t px; uint32_t qty; char side; };\n\nstruct NseGateway { void send(const Order& o) { /* encode + write to socket */ } };\nstruct SimGateway { void send(const Order& o) { /* push to back-test engine */ } };\n\ntemplate <typename Venue>\nvoid postOrder(Venue& v, const Order& o) {\n    // risk checks are generic, the send is resolved at compile time\n    if (o.qty == 0) return;\n    v.send(o);                 // direct call: no vptr load, inlinable\n}\n\nNseGateway nse; SimGateway sim;\npostOrder(nse, o);   // instantiates postOrder<NseGateway>\npostOrder(sim, o);   // instantiates postOrder<SimGateway>\n```\n\nYou can also put *values* in template parameters, e.g. the side of the book, so the branch on side disappears at compile time:\n\n```cpp\nenum class Side { Buy, Sell };\ntemplate <Side S>\nbool crosses(int64_t myPx, int64_t bestOpp) {\n    if constexpr (S == Side::Buy) return myPx >= bestOpp;  // only this branch is compiled\n    else                          return myPx <= bestOpp;\n}\n```\n\n**In class:** the containers we wrote are templates too: the custom `vector<T>` (with `mSize`, `mCapacity`, `T* mData`) and the SPSC ring buffer `SPSCQueue<T, Capacity>`, where `Capacity` is a non-type template parameter checked with `static_assert((Capacity & (Capacity - 1)) == 0)` and `kMask = Capacity - 1` is a `static constexpr`, so `index & kMask` replaces a costly `%`."
  },
  {
   "heading": "Writing templates and how they resolve at compile time",
   "body": "A template is not code; it is a **recipe**. Code exists only when the template is **instantiated** with concrete arguments. Each distinct set of arguments produces a separate function or class in the object file.\n\n```cpp\ntemplate <typename T>\nT add(T a, T b) { return a + b; }\n\nadd(1, 2);       // instantiates add<int>    -> symbol _Z3addIiET_S0_S0_\nadd(1.0, 2.0);   // instantiates add<double> -> a second, separate function\nadd(1, 2.0);     // ERROR: T deduced as int AND double (conflict)\nadd<double>(1, 2.0); // OK: T given explicitly, 1 converts to double\n```\n\nWhat Compiler Explorer (godbolt.org) shows you:\n- One assembly function per instantiation, with mangled names like `_Z3addIiET_S0_S0_` (`add<int>`).\n- At `-O2` the call usually vanishes entirely: `add(1,2)` becomes `mov eax, 3`. Templates cost **zero runtime** for dispatch; the price is paid at compile time.\n- An uninstantiated template generates no code at all.\n\nKey mechanics:\n- **Two-phase lookup:** non-dependent names are checked at definition; names that depend on `T` are checked at instantiation. That's why you write `typename T::value_type` (tell the compiler a dependent name is a type) and `this->member` inside templates that derive from a dependent base.\n- **Templates live in headers:** the compiler needs the full definition at the point of instantiation (or you use explicit instantiation `template int add<int>(int,int);` in one .cpp).\n- **Linkage:** identical instantiations in many .cpp files are merged by the linker (they're emitted as weak/COMDAT symbols), so no ODR error.\n- **Cost:** code bloat (one copy per type, which pressures the instruction cache) and longer compile times. In return: no indirection, full inlining, and constant folding per type."
  },
  {
   "heading": "auto",
   "body": "`auto` asks the compiler to deduce a variable's type from its initializer, using (almost exactly) the **template deduction rules for a by-value parameter**.\n\n```cpp\nconst int cx = 42;\nint& rx = x;\n\nauto a = cx;     // int        (top-level const dropped: it's a copy)\nauto b = rx;     // int        (reference dropped)\nauto& c = cx;    // const int& (reference keeps const)\nauto&& d = x;    // int&       (forwarding ref + lvalue -> lvalue ref)\nauto&& e = 42;   // int&&\nauto* p = &cx;   // const int*\n```\n\nThe one difference from templates: braced initializers.\n\n```cpp\nauto l = {1, 2};   // std::initializer_list<int>\nauto m{1};         // int (C++17 rule)\nauto n = {1, 2.0}; // ERROR: can't deduce initializer_list<T>\ntemplate<class T> void f(T); f({1,2}); // ERROR: templates never deduce from {..}\n```\n\nWhere `auto` helps performance code:\n- `for (const auto& lvl : book)`: no copies. **Trap:** `for (auto lvl : book)` copies every element.\n- `auto it = m.find(k);` avoids spelling `std::map<Price, std::vector<Order>>::iterator`.\n- Iterating a `std::map` with `const std::pair<int, X>&` (missing `const` on the key) silently creates a temporary copy per element, because the element type is `std::pair<const int, X>`. `const auto&` gets it right.\n- C++14 `auto` return types and C++20 abbreviated templates: `void log(const auto& x)` is a function template."
  },
  {
   "heading": "Template type deduction rules (Scott Meyers, Effective Modern C++ Item 1)",
   "body": "For `template<typename T> void f(ParamType param); f(expr);` the compiler deduces **both** `T` and `ParamType`. Three cases:\n\n### Case 1: ParamType is a reference or pointer (not a universal ref): `f(T& param)`\nIgnore the reference part of `expr`, then pattern-match. **const is kept.**\n\n```cpp\ntemplate<class T> void f(T& p);\nint x = 1; const int cx = x; const int& rx = x;\nf(x);   // T = int,        param: int&\nf(cx);  // T = const int,  param: const int&\nf(rx);  // T = const int,  param: const int&\nf(27);  // ERROR: an rvalue can't bind to T&\n```\n\n### Case 2: ParamType is a universal (forwarding) reference: `f(T&& param)`\n- lvalue argument: `T` is deduced as an **lvalue reference** (`int&`), and reference collapsing makes `param` `int&`.\n- rvalue argument: Case 1 rules, `T = int`, `param` is `int&&`.\n\n```cpp\ntemplate<class T> void f(T&& p);\nf(x);   // T = int&,        param: int&\nf(cx);  // T = const int&,  param: const int&\nf(27);  // T = int,         param: int&&\n```\n\n### Case 3: by value: `f(T param)`\nIt's a new copy, so drop reference, then drop **top-level** const and volatile.\n\n```cpp\ntemplate<class T> void f(T p);\nf(cx);  // T = int\nf(rx);  // T = int\nconst char* const s = \"hi\";\nf(s);   // T = const char*  (pointer's own const dropped, pointee const kept)\n```\n\n### Arrays and functions decay (except into references)\n\n```cpp\nconst char name[] = \"ACME\";         // const char[5]\ntemplate<class T> void byVal(T);   byVal(name);  // T = const char*\ntemplate<class T> void byRef(T&);  byRef(name);  // T = const char[5]\ntemplate<class T, std::size_t N>\nconstexpr std::size_t arraySize(T (&)[N]) noexcept { return N; }  // compile-time size: 5\n```\n\nTo *see* a deduced type, provoke an error: `template<class> struct TD; TD<decltype(x)> td;` and read the compiler's message."
  },
  {
   "heading": "Variadic templates (basics)",
   "body": "A **parameter pack** accepts zero or more template arguments. `sizeof...(Ts)` gives the count at compile time. Use: logging, `make_unique`/`emplace_back`, tuples, sending a message built from many fields.\n\n```cpp\n// C++11 style: recursion with a base case\nvoid print() {}                                    // base case: empty pack\ntemplate <typename T, typename... Rest>\nvoid print(const T& first, const Rest&... rest) {\n    std::cout << first << ' ';\n    print(rest...);                                // pack expansion\n}\n\n// C++17 fold expressions: no recursion needed\ntemplate <typename... Ts>\nauto sum(Ts... ts) { return (ts + ... + 0); }      // binary right fold, sum() == 0\n\ntemplate <typename... Ts>\nvoid log(const Ts&... ts) { ((std::cout << ts << ' '), ...); }  // fold over comma\n\ntemplate <typename... Ts>\nconstexpr bool allPositive(Ts... ts) { return ((ts > 0) && ...); } // empty pack -> true\n```\n\nFolds: `(pack op ...)` unary right, `(... op pack)` unary left, `(pack op ... op init)` binary. An **empty** unary fold is only allowed for `&&` (gives `true`), `||` (gives `false`) and `,` (gives `void()`); `(ts + ...)` with an empty pack is a compile error, which is why `sum` above uses the binary form with `0`.\n\nPerfect-forwarding pack (you'll see this again with `std::forward`):\n\n```cpp\ntemplate <typename T, typename... Args>\nstd::unique_ptr<T> make(Args&&... args) {\n    return std::unique_ptr<T>(new T(std::forward<Args>(args)...));\n}\n```\n\nEverything is expanded at compile time: `print(1, 2.5, \"x\")` instantiates three `print` overloads, each typically inlined into straight-line code."
  },
  {
   "heading": "Template specialization (and the famous interview questions)",
   "body": "**Full (explicit) specialization:** a custom implementation for one exact set of arguments. **Partial specialization:** for a *pattern* of arguments (class templates and variable templates only; **function templates cannot be partially specialized**, overload them instead).\n\n```cpp\ntemplate <typename T> struct IsPointer      { static constexpr bool value = false; };\ntemplate <typename T> struct IsPointer<T*>  { static constexpr bool value = true;  }; // partial\ntemplate <>           struct IsPointer<std::nullptr_t> { static constexpr bool value = false; }; // full\n\nstatic_assert(IsPointer<int*>::value && !IsPointer<int>::value);\n```\n\n**In class (Lec-8 `utils.h`):** we wrote our own `remove_reference` using exactly this: the primary template keeps `T`, and two partial specializations strip `T&` and `T&&`:\n\n```cpp\ntemplate <typename T> struct Remove_Ref       { using type = T; };\ntemplate <typename T> struct Remove_Ref<T&>   { using type = T; };\ntemplate <typename T> struct Remove_Ref<T&&>  { using type = T; };\n```\n\nClassic interview questions (HRT / Jane Street / Optiver style):\n\n1. **Compile-time factorial / Fibonacci** via recursion plus a full specialization as the base case:\n\n```cpp\ntemplate <unsigned N> struct Fact    { static constexpr unsigned long long value = N * Fact<N-1>::value; };\ntemplate <>           struct Fact<0> { static constexpr unsigned long long value = 1; };\nstatic_assert(Fact<5>::value == 120);   // zero runtime cost: it's a constant in the binary\n```\n\n2. **Implement `is_same`:** primary = `false`, partial `<T, T>` = `true`.\n3. **Specialization vs overloading order (Dimov/Abrahams):** an explicit specialization specializes whichever primary template is visible *when it is declared*. Overload resolution picks among **primary templates only** and then looks at their specializations. So:\n\n```cpp\ntemplate<class T> void f(T);        // (a)\ntemplate<>        void f<>(int*);   // (c) specializes (a): only (a) exists yet\ntemplate<class T> void f(T*);       // (b)\nint* p; f(p);   // calls (b)! (b) is more specialized than (a); (c) is ignored\n// Move (c) below (b) and f(p) calls (c).\n```\n\nLesson: prefer **plain overloads** over function template specializations.\n\n4. **`std::vector<bool>`** is the standard's (infamous) specialization: it packs bits, so `operator[]` returns a proxy object, not a `bool&`, and `auto x = v[0];` gives you a proxy.\n\n5. Tag dispatch / per-type fast paths: specialize a `Serializer<T>` so trivially copyable types use `memcpy` and others go field by field."
  },
  {
   "heading": "V-table theory and why the destructor must be virtual",
   "body": "When a class has at least one `virtual` function:\n- The compiler builds **one vtable per class** (a static array of function pointers, in read-only data).\n- **Each object** gets a hidden **vptr** (8 bytes on x86-64, usually at offset 0) pointing to its class's vtable. The constructor sets it; during the base constructor it points to the *base* vtable, which is why a virtual call inside a constructor does **not** dispatch to the derived override.\n\n```cpp\nstruct E  {};                                // sizeof 1\nstruct V  { virtual void h(); };             // sizeof 8  (just the vptr)\nstruct V2 { virtual void h(); virtual void k(); int x; }; // sizeof 16 (vptr 8 + int 4 + padding 4)\n```\n\nAdding more virtual functions does not grow objects; it grows the (shared) vtable.\n\n### Virtual destructor: why\n\n```cpp\nstruct Order       { ~Order() {} };               // NOT virtual\nstruct IcebergOrder : Order { std::vector<int> slices; };\n\nOrder* o = new IcebergOrder;\ndelete o;   // UNDEFINED BEHAVIOUR: only ~Order runs, slices leaks (in practice)\n```\n\n`delete` through a base pointer calls the destructor **through the vtable** only if it is virtual. Rule: **a class meant to be deleted polymorphically needs a public virtual destructor** (or make it protected and non-virtual so deleting via base won't compile). `std::unique_ptr<Base>` has the same requirement; `std::shared_ptr<Base>` created with `make_shared<Derived>` happens to remember the right deleter, but don't rely on it.\n\n### Object slicing\n\n```cpp\nvoid call(Base b) { b.who(); }   // by value: copies only the Base part, vptr = Base's\nDerived d; call(d);              // prints \"Base\", not \"Derived\"\n```\n\nPolymorphism works only through **pointers or references**."
  },
  {
   "heading": "Indirection cost: latency with and without virtual",
   "body": "A virtual call `obj->f()` compiles to roughly:\n\n```cpp\n// mov rax, [rdi]        ; load vptr from the object   (possible cache miss #1)\n// call [rax + 16]       ; load slot, indirect call    (possible cache miss #2)\n// a non-virtual call is just:  call Foo::f   (or nothing at all, once inlined)\n```\n\nWhat it really costs:\n\n| Cost | Rough size |\n|---|---|\n| Two dependent loads (vptr, then slot) | ~1 ns each if in L1; ~60–100 ns if the object or vtable is in DRAM |\n| Indirect branch, **predicted** | ~1–3 cycles extra |\n| Indirect branch, **mispredicted** (many types mixed in one loop) | ~15–20 cycles (~5 ns at 3–4 GHz) pipeline flush |\n| **Lost inlining** (the big one) | no constant propagation, no hoisting, no vectorization of the loop around it |\n\nSo in a tight loop over a million ticks, `virtual double price()` can be several times slower than the inlined version, mostly because the compiler cannot optimise *across* the call, not because of the jump itself.\n\nWays to keep polymorphism and lose the cost:\n1. **Templates / CRTP** (static polymorphism, next section).\n2. `final` on a class or function lets the compiler **devirtualize** when the static type is known.\n3. `std::variant` + `std::visit`: closed set of types, a jump table, no heap allocation.\n4. Group objects by concrete type (one vector per type) so each loop is monomorphic and predictable.\n5. Keep virtual for the **cold path** (configuration, startup); avoid it on the hot path.\n\nMeasure with `perf stat -e branch-misses` and Compiler Explorer (look for `call qword ptr [rax+...]`)."
  },
  {
   "heading": "CRTP: the first HFT pattern",
   "body": "**Curiously Recurring Template Pattern:** a class derives from a base template instantiated with *itself*. The base calls into the derived class via `static_cast<Derived*>(this)`, resolved at **compile time**, so there's no vptr, no vtable and the call inlines.\n\n```cpp\nstruct Tick { int64_t px; uint32_t qty; };\n\ntemplate <typename Derived>\nclass Strategy {\npublic:\n    void onTick(const Tick& t) {               // common pipeline in the base\n        if (t.qty == 0) return;                // shared pre-checks\n        static_cast<Derived*>(this)->onTickImpl(t);   // static dispatch\n    }\n};\n\nclass MeanReversion : public Strategy<MeanReversion> {\npublic:\n    void onTickImpl(const Tick& t) { /* signal logic */ }\n};\n\nclass Momentum : public Strategy<Momentum> {\npublic:\n    void onTickImpl(const Tick& t) { /* signal logic */ }\n};\n\ntemplate <typename S>\nvoid runLoop(Strategy<S>& s, const std::vector<Tick>& ticks) {\n    for (const auto& t : ticks) s.onTick(t);  // fully inlined per strategy\n}\n```\n\nTrade-offs:\n\n| | virtual | CRTP |\n|---|---|---|\n| Dispatch | runtime, vtable | compile time |\n| Per-object overhead | 8-byte vptr | none |\n| Inlining | blocked (unless devirtualized) | yes |\n| Heterogeneous container (`vector<Base*>`) | yes | **no**: `Strategy<A>` and `Strategy<B>` are unrelated types |\n| Code size | one copy | one copy per derived type |\n\nOther CRTP uses: mix-ins (`Comparable<T>` giving `operator!=` from `operator==`), per-type instance counters, and the C++23 alternative **deducing this** (`void onTick(this auto& self, const Tick& t)`).\n\nPitfall: `class B : public Strategy<A>` (wrong argument, a copy-paste bug) compiles and is UB; a common guard is to make the base constructor private and `friend Derived;`."
  },
  {
   "heading": "decltype and decltype(auto)",
   "body": "`decltype(e)` yields the type of an expression **without evaluating it**.\n\n- `decltype(name)` (an unparenthesized variable or member name): the **declared** type, references and const included.\n- `decltype(expr)` for any other expression: `T&` if the expression is an lvalue, `T&&` if xvalue, `T` if prvalue.\n\n```cpp\nint x = 0; const int& cr = x;\ndecltype(x)    a = 1;    // int\ndecltype(cr)   b = x;    // const int&\ndecltype((x))  c = x;    // int&   <- parentheses make it an lvalue expression\ndecltype(x+1)  d = 2;    // int (prvalue)\n```\n\n`decltype(auto)` (C++14) means \"deduce with `auto`'s convenience but `decltype`'s rules\", so references are preserved. Its main use is **forwarding return types** from a wrapper:\n\n```cpp\ntemplate <typename Container, typename Index>\ndecltype(auto) at(Container&& c, Index i) {\n    return std::forward<Container>(c)[i];   // returns T& for an lvalue container, like operator[]\n}\n// with plain `auto` it would return a copy and `at(v, 0) = 5;` wouldn't compile\n```\n\n**The dangling trap:**\n\n```cpp\ndecltype(auto) bad() {\n    int local = 5;\n    return (local);   // decltype((local)) == int&  -> returns a reference to a dead local: UB\n}\n```"
  },
  {
   "heading": "constexpr, consteval, constinit",
   "body": "Move work from runtime to compile time: zero cycles on the hot path.\n\n| Keyword | Meaning |\n|---|---|\n| `constexpr` variable | must be initialized by a constant expression; implicitly `const` |\n| `constexpr` function | *may* run at compile time if arguments are constants; can still run at runtime |\n| `consteval` (C++20) | **immediate function**: every call *must* be evaluated at compile time, otherwise a compile error |\n| `constinit` (C++20) | static/thread-local variable must be **initialized** at compile time (no static-init-order fiasco) but is **not** const |\n| `if constexpr` (C++17) | discards the untaken branch at compile time (it isn't even instantiated) |\n\n```cpp\nconstexpr uint64_t pow10(int n) { uint64_t r = 1; while (n--) r *= 10; return r; }\n\nconstexpr auto kScale = pow10(8);        // computed by the compiler\nint digits = readConfig();\nauto s = pow10(digits);                  // fine: runs at runtime\n\nconsteval uint64_t tickSize(int n) { return pow10(n); }\nauto t = tickSize(digits);               // ERROR: not a constant expression\n\n// compile-time lookup table: an array baked into .rodata\nconstexpr std::array<uint8_t, 256> kPopcount = [] {\n    std::array<uint8_t, 256> t{};\n    for (int i = 0; i < 256; ++i) t[i] = (i & 1) + t[i / 2];\n    return t;\n}();\n```\n\nUB is **not allowed** inside constant evaluation (overflow, out-of-bounds), so the compiler rejects it: `static_assert` on constexpr code is a cheap UB detector. `std::is_constant_evaluated()` / `if consteval` (C++23) let one function pick a compile-time-friendly path vs a fast runtime path (e.g. intrinsics)."
  },
  {
   "heading": "Casts: static_cast, dynamic_cast, reinterpret_cast, const_cast",
   "body": "| Cast | Checked when | Typical use | Runtime cost |\n|---|---|---|---|\n| `static_cast<T>` | compile time | numeric conversions, `void*` to `T*`, **upcast**, unchecked downcast, `T&&` (that's what `std::move` is) | none (maybe an add for base-offset adjustment) |\n| `dynamic_cast<T>` | **runtime**, via RTTI | safe downcast/cross-cast of a **polymorphic** type | walks type info: tens to hundreds of ns; string compares across shared libs |\n| `reinterpret_cast<T>` | none | reinterpret bits: pointer to integer, unrelated pointer types | none |\n| `const_cast<T>` | compile time | add/remove `const`/`volatile` (for legacy APIs) | none |\n| C-style `(T)x` | tries const, static, then reinterpret | avoid: hides which one you got | n/a |\n\n```cpp\nstruct Base { virtual ~Base() = default; };\nstruct Limit : Base { int64_t px; };\nstruct Market : Base {};\n\nBase* b = new Market;\nLimit* l1 = static_cast<Limit*>(b);    // compiles; using l1->px is UB (it's a Market)\nLimit* l2 = dynamic_cast<Limit*>(b);   // nullptr: checked at runtime\nLimit& l3 = dynamic_cast<Limit&>(*b);  // throws std::bad_cast\n```\n\n`dynamic_cast` needs the source to be polymorphic (at least one virtual function) and RTTI on (`-fno-rtti` disables it). In HFT code it's a red flag on the hot path: design so you already know the type (CRTP, variant, a type tag in the message header).\n\n**In class (Lec-9 homework):** a **memory pool** allocates one huge chunk at startup (e.g. `new std::byte[1 << 30]`) because `new` costs roughly half a microsecond to microseconds on a bad day, then hands out slices of it as `Order` objects with `reinterpret_cast`. The safe way to do that:\n\n```cpp\nalignas(Order) static std::byte pool[sizeof(Order) * 1024];\nOrder* o = new (pool + i * sizeof(Order)) Order{...};  // placement new starts the object's lifetime\n// reinterpret_cast<Order*>(pool) alone does NOT create an Order (UB on access before C++20's\n// implicit-lifetime rules, and only OK for trivial types after them); always check alignment.\n```\n\nReinterpreting an existing object as an unrelated type (the class sketch `c = reinterpret_cast<C*>(d)` with `struct C{int a; int b;}` over `struct D{long long a;}`) breaks **strict aliasing**: reading through `C*` is UB, and the optimiser may reorder or drop loads. To reinterpret bytes legally use `std::memcpy` (compiles to a single `mov`) or C++20 `std::bit_cast<C>(d)`. Exceptions: you may always inspect any object through `char*`, `unsigned char*` or `std::byte*`."
  },
  {
   "heading": "Quick revision",
   "body": "- Templates are instantiated per distinct argument set at compile time; uninstantiated templates emit no code.\n- Template dispatch = direct call + inlining; cost is compile time and code size (I-cache).\n- `auto x = expr` follows by-value deduction: drops reference and top-level const.\n- `auto l = {1,2}` is `std::initializer_list<int>`; a template `T` never deduces from braces.\n- Meyers' 3 cases: `T&` keeps const; `T&&` with an lvalue makes `T` an lvalue reference; `T` by value strips ref and top-level cv.\n- Arrays/functions decay to pointers when passed by value, not when bound to `T&`.\n- `sizeof...(Ts)` counts a pack; C++17 folds `(ts + ... + 0)` replace recursion.\n- Function templates: full specialization only; partial specialization is for class templates. Prefer overloads.\n- Overload resolution considers primary templates first, then their specializations.\n- vptr = 8 bytes per object, vtable = one per class; extra virtual functions don't grow objects.\n- Polymorphic base => virtual destructor, else `delete base_ptr` is UB.\n- Virtual call: 2 dependent loads + indirect branch; the real loss is inlining.\n- `final` lets the compiler devirtualize.\n- CRTP: `class D : Base<D>`, base does `static_cast<D*>(this)->impl()`, zero overhead, no heterogeneous containers.\n- `decltype((x))` is `T&`; `decltype(auto)` preserves references (can dangle).\n- `constexpr` may run at compile time, `consteval` must, `constinit` forces compile-time init of a mutable static.\n- `dynamic_cast` returns `nullptr` (pointer) or throws `std::bad_cast` (reference); needs a polymorphic type.\n- `reinterpret_cast` between unrelated object types + dereference = strict-aliasing UB; use `memcpy`/`std::bit_cast`/placement new."
  },
  {
   "heading": "Exam traps",
   "body": "- **Virtual call in a constructor/destructor** calls the *current* class's version, not the derived override (the vptr points at the class being constructed).\n- **Default arguments of virtual functions** are bound statically: `Base* p = new D; p->f();` uses `Base`'s default argument with `D`'s body.\n- **Slicing:** passing a `Derived` by value as `Base` calls `Base::who()`.\n- `add(1, 2.0)` with `template<class T> T add(T, T)` does **not** compile: conflicting deductions; no implicit conversions during deduction.\n- **`typename` missing** in `T::value_type x;` is a compile error in a template (dependent name assumed to be a value).\n- **Class template argument deduction** (C++17): `std::vector v{1, 2};` is `vector<int>`, but `std::vector v{otherVec};` is a *copy*, not `vector<vector<int>>`.\n- `decltype(auto)` + `return (local);` returns a dangling reference.\n- `constexpr` function does **not** guarantee compile-time evaluation; you need a constant-expression context (`constexpr` variable, template argument, `static_assert`) or `consteval`.\n- `const_cast` away const on an object **defined** `const` and writing to it is UB.\n- `dynamic_cast` on a non-polymorphic class: compile error for downcasts.\n- `static_cast` downcast to the wrong type compiles and is UB: no runtime check.\n- A virtual function that is a template? **Not allowed**: member function templates cannot be virtual (the vtable size must be known).\n- `sizeof` an empty class is 1, but an empty base adds 0 bytes (EBO); a class with one virtual function and no data is 8 on x86-64.\n- Template code errors appear only when instantiated: a template that's never used can contain type errors in dependent code and still compile."
  }
 ],
 "keyTerms": [
  {
   "term": "Instantiation",
   "def": "The compiler generating a concrete function/class from a template for specific template arguments."
  },
  {
   "term": "Template argument deduction",
   "def": "Inferring template parameters from a call's argument types."
  },
  {
   "term": "Non-type template parameter",
   "def": "A compile-time value parameter such as `std::size_t Capacity` in `SPSCQueue<T, Capacity>`."
  },
  {
   "term": "Universal (forwarding) reference",
   "def": "`T&&` where `T` is deduced (or `auto&&`): binds to lvalues and rvalues."
  },
  {
   "term": "Parameter pack",
   "def": "`typename... Ts` / `Ts... args`: zero or more template arguments or function arguments."
  },
  {
   "term": "Fold expression",
   "def": "C++17 syntax `(args op ...)` that expands a pack with a binary operator."
  },
  {
   "term": "Full specialization",
   "def": "`template<> struct X<int>`: an implementation for one exact argument list."
  },
  {
   "term": "Partial specialization",
   "def": "A class template specialization for a pattern such as `X<T*>`; not allowed for function templates."
  },
  {
   "term": "vtable",
   "def": "Per-class table of function pointers used for virtual dispatch."
  },
  {
   "term": "vptr",
   "def": "Hidden per-object pointer (8 bytes on x86-64) to the class's vtable."
  },
  {
   "term": "Devirtualization",
   "def": "Compiler replacing a virtual call with a direct call when the dynamic type is known (helped by `final`)."
  },
  {
   "term": "CRTP",
   "def": "`class D : public Base<D>`: static polymorphism where the base calls `static_cast<D*>(this)->impl()`."
  },
  {
   "term": "decltype(auto)",
   "def": "Return/variable type deduction that keeps references and cv-qualifiers using decltype rules."
  },
  {
   "term": "consteval",
   "def": "C++20 immediate function: every call must be a compile-time constant."
  },
  {
   "term": "constinit",
   "def": "C++20: a static-storage variable must be constant-initialized; it stays mutable."
  },
  {
   "term": "RTTI",
   "def": "Run-time type information used by `dynamic_cast` and `typeid`."
  },
  {
   "term": "Strict aliasing",
   "def": "Rule that an object may only be accessed through its own type (or char/byte); violating it is UB."
  },
  {
   "term": "Object slicing",
   "def": "Copying a derived object into a base object, losing the derived part and its dynamic type."
  }
 ],
 "mcqs": [
  {
   "q": "Given `template<class T> T add(T a, T b) { return a + b; }`, what happens with `add(1, 2.0);`?",
   "options": [
    "Returns 3.0 as a double",
    "Compile error: T deduced as both int and double",
    "Returns 3 as an int",
    "Undefined behaviour"
   ],
   "answer": 1,
   "explanation": "Each argument deduces T independently (int and double); conflicting deductions make the call ill-formed, and no implicit conversions are considered during deduction.",
   "distractors": "The 'returns' options assume a promotion that deduction never performs; you'd need `add<double>(1, 2.0)`.",
   "source": "lecture",
   "id": "L05-m1"
  },
  {
   "q": "Under the template deduction rules, what is `T` in this call?\n    template<class T> void f(T param);\n    const int& rx = x;\n    f(rx);",
   "options": [
    "int&",
    "const int",
    "const int&",
    "int"
   ],
   "answer": 3,
   "explanation": "By-value parameters drop the reference and then the top-level const, because `param` is an independent copy.",
   "distractors": "`const int` / `const int&` would be right for a `T&` parameter, not a by-value one.",
   "source": "lecture",
   "id": "L05-m2"
  },
  {
   "q": "What is `T` in this call?\n    template<class T> void f(T&& param);\n    int x = 5;\n    f(x);",
   "options": [
    "int&",
    "int&&",
    "const int&",
    "int"
   ],
   "answer": 0,
   "explanation": "For a forwarding reference, an lvalue argument makes T an lvalue reference (`int&`), and `int& &&` collapses to `int&`.",
   "distractors": "`int` is what T would be for an rvalue like `f(5)`; `int&&` is never deduced for T itself here.",
   "source": "lecture",
   "id": "L05-m3"
  },
  {
   "q": "What is the type of `l`?\n    auto l = {1, 2, 3};",
   "options": [
    "int[3]",
    "std::vector<int>",
    "std::initializer_list<int>",
    "Compile error"
   ],
   "answer": 2,
   "explanation": "`auto` with copy-list-initialization deduces `std::initializer_list<T>`; this is the one place `auto` differs from template deduction.",
   "distractors": "Templates refuse to deduce from braces, but `auto` doesn't, and it never produces an array or vector.",
   "source": "lecture",
   "id": "L05-m4"
  },
  {
   "q": "What does this program print?\n    template<class T> void f(T)  { std::cout << \"a\"; }\n    template<>        void f<>(int*) { std::cout << \"c\"; }\n    template<class T> void f(T*) { std::cout << \"b\"; }\n    int main() { int* p = nullptr; f(p); }",
   "options": [
    "a",
    "c",
    "b",
    "Ambiguous call: compile error"
   ],
   "answer": 2,
   "explanation": "The explicit specialization was declared when only `f(T)` existed, so it specializes that one. Overload resolution picks the more specialized primary template `f(T*)`, which has no specialization, so it prints b.",
   "distractors": "Specializations don't take part in overload resolution themselves, so 'c' would only print if the specialization came after `f(T*)`.",
   "source": "lecture",
   "id": "L05-m5"
  },
  {
   "q": "On x86-64 with GCC, what is `sizeof(V)`?\n    struct V { virtual void a(); virtual void b(); virtual void c(); int x; };",
   "options": [
    "16",
    "4",
    "28",
    "32"
   ],
   "answer": 0,
   "explanation": "One 8-byte vptr no matter how many virtual functions there are, plus a 4-byte int, padded to 8-byte alignment: 16.",
   "distractors": "Virtual functions live in the shared vtable, so they don't add a pointer each (28 and 32 assume they do).",
   "source": "lecture",
   "id": "L05-m6"
  },
  {
   "q": "What does this print?\n    struct B { virtual void who() { std::cout << \"B\"; } };\n    struct D : B { void who() override { std::cout << \"D\"; } };\n    void call(B b) { b.who(); }\n    int main() { D d; call(d); B& r = d; r.who(); }",
   "options": [
    "DD",
    "DB",
    "BB",
    "BD"
   ],
   "answer": 3,
   "explanation": "`call` takes B by value, so the D is sliced into a fresh B whose vptr is B's: prints B. The reference keeps the dynamic type: prints D.",
   "distractors": "Virtual dispatch only works through pointers or references; a by-value parameter is a new B object.",
   "source": "lecture",
   "id": "L05-m7"
  },
  {
   "q": "`Base* p = new Derived; delete p;` where `Base` has a non-virtual destructor and `Derived` owns a `std::vector`. What does the standard say?",
   "options": [
    "Only ~Base runs, which is well-defined",
    "Undefined behaviour",
    "Both destructors run because delete knows the dynamic type",
    "Compile error"
   ],
   "answer": 1,
   "explanation": "Deleting a derived object through a base pointer whose destructor isn't virtual is undefined behaviour; in practice ~Derived is skipped and the vector leaks.",
   "distractors": "'Only ~Base runs' describes typical behaviour, but the standard calls it UB, and it isn't a compile error.",
   "source": "lecture",
   "id": "L05-m8"
  },
  {
   "q": "Inside a tight loop, what is usually the **largest** cost of a virtual call compared with a non-virtual one?",
   "options": [
    "The extra 8 bytes per object",
    "The compiler cannot inline it, so it can't optimise or vectorise across the call",
    "A syscall to look up the vtable",
    "Allocating the vtable on each call"
   ],
   "answer": 1,
   "explanation": "A correctly predicted indirect branch costs only a few cycles; losing inlining blocks constant propagation, hoisting and SIMD, which often costs much more.",
   "distractors": "Vtables are static and no syscall or allocation happens; the vptr size matters for cache footprint but isn't the main cost.",
   "source": "lecture",
   "id": "L05-m9"
  },
  {
   "q": "Which statement about CRTP is FALSE?",
   "options": [
    "The base calls the derived implementation via `static_cast<Derived*>(this)`",
    "Calls are resolved at compile time and can be inlined",
    "It adds no vptr to the object",
    "You can store `Strategy<A>` and `Strategy<B>` objects in one `std::vector<Strategy*>` and dispatch at runtime"
   ],
   "answer": 3,
   "explanation": "`Strategy<A>` and `Strategy<B>` are unrelated types, so there's no common base for a heterogeneous container. That's the price of static polymorphism.",
   "distractors": "The other three are the defining properties of CRTP.",
   "source": "lecture",
   "id": "L05-m10"
  },
  {
   "q": "What is `decltype((x))` when `x` is declared `int x = 0;`?",
   "options": [
    "int&",
    "const int",
    "int&&",
    "int"
   ],
   "answer": 0,
   "explanation": "With extra parentheses, `(x)` is an lvalue expression rather than a plain name, and decltype of an lvalue expression gives `T&`.",
   "distractors": "`decltype(x)` without parentheses gives the declared type `int`.",
   "source": "lecture",
   "id": "L05-m11"
  },
  {
   "q": "What is wrong with this function?\n    decltype(auto) get() { int local = 42; return (local); }",
   "options": [
    "Nothing: it returns 42 by value",
    "It doesn't compile: decltype(auto) can't be a return type",
    "It returns `int&` to a destroyed local, so using the result is UB",
    "It returns `int&&`"
   ],
   "answer": 2,
   "explanation": "`(local)` is an lvalue expression, so decltype(auto) deduces `int&`: a dangling reference.",
   "distractors": "Without the parentheses it would return `int` by value; decltype(auto) return types have been legal since C++14.",
   "source": "lecture",
   "id": "L05-m12"
  },
  {
   "q": "`consteval int sq(int n) { return n * n; }` and `int k = readInt();`. Which line fails to compile?",
   "options": [
    "`constexpr int a = sq(4);`",
    "`int b = sq(4);`",
    "`int c = sq(k);`",
    "`static_assert(sq(3) == 9);`"
   ],
   "answer": 2,
   "explanation": "A consteval (immediate) function must produce a constant on every call; `k` is only known at runtime.",
   "distractors": "The other calls have constant arguments, so they're evaluated at compile time even when assigned to a non-constexpr variable.",
   "source": "lecture",
   "id": "L05-m13"
  },
  {
   "q": "`Base* b = new Market;` (`Market` and `Limit` both derive from a polymorphic `Base`). What does `dynamic_cast<Limit*>(b)` return?",
   "options": [
    "nullptr",
    "A pointer to the Market reinterpreted as Limit",
    "It throws std::bad_cast",
    "Compile error"
   ],
   "answer": 0,
   "explanation": "A failed dynamic_cast to a pointer type returns nullptr; only the reference form throws std::bad_cast.",
   "distractors": "Reinterpreting is what static_cast would silently do (UB on use); it compiles because Base is polymorphic.",
   "source": "lecture",
   "id": "L05-m14"
  },
  {
   "q": "Which is the standard-conforming, zero-overhead way to read the 8 bytes of a `double d` as a `uint64_t`?",
   "options": [
    "`*reinterpret_cast<uint64_t*>(&d)`",
    "`*(uint64_t*)&d`",
    "`static_cast<uint64_t>(d)`",
    "`std::bit_cast<uint64_t>(d)` (or `std::memcpy` into a uint64_t)"
   ],
   "answer": 3,
   "explanation": "bit_cast/memcpy copy the object representation without violating strict aliasing, and both compile to a single register move.",
   "distractors": "The pointer casts are strict-aliasing UB; static_cast converts the *value* (3.7 becomes 3), not the bits.",
   "source": "lecture",
   "id": "L05-m15"
  },
  {
   "q": "What does `sum()` return?\n    template<class... Ts> auto sum(Ts... ts) { return (ts + ... + 0); }",
   "options": [
    "Compile error: empty pack",
    "0",
    "Undefined",
    "1"
   ],
   "answer": 1,
   "explanation": "This is a binary fold with initial value 0, so an empty pack yields just 0. The unary fold `(ts + ...)` would fail to compile with an empty pack.",
   "distractors": "Only unary folds over + reject empty packs; && / || / , have defined empty values.",
   "source": "lecture",
   "id": "L05-m16"
  },
  {
   "q": "Which can be **partially** specialized?",
   "options": [
    "A function template",
    "A class template",
    "A virtual member function",
    "A non-template class"
   ],
   "answer": 1,
   "explanation": "Partial specialization is allowed for class (and variable) templates only; function templates use overloading instead.",
   "distractors": "Function templates allow full specialization only; non-templates and virtual functions have nothing to specialize.",
   "source": "lecture",
   "id": "L05-m17"
  },
  {
   "q": "Why does `template<class T> T& at(...)` usually beat a `virtual T& at(...)` in an order-book hot loop?",
   "options": [
    "Templates allocate memory on the stack instead of the heap",
    "Templates avoid RTTI lookups on every call",
    "Virtual functions require a mutex",
    "Template calls are direct and inlinable, enabling constant folding and vectorisation"
   ],
   "answer": 3,
   "explanation": "Static dispatch lets the optimiser see through the call; the generated code per instantiation is as if hand-written for that type.",
   "distractors": "Virtual calls use the vtable, not RTTI, and neither involves locks or memory placement.",
   "source": "lecture",
   "id": "L05-m18"
  },
  {
   "q": "What does this print?\n    struct B { virtual void f(int x = 1) { std::cout << \"B\" << x; } };\n    struct D : B { void f(int x = 2) override { std::cout << \"D\" << x; } };\n    int main() { B* p = new D; p->f(); }",
   "options": [
    "D1",
    "D2",
    "B2",
    "B1"
   ],
   "answer": 0,
   "explanation": "The body is chosen at runtime (D's override), but default arguments are bound at compile time from the static type B*, so x = 1.",
   "distractors": "D2 assumes default arguments are dispatched virtually; B1 ignores the override.",
   "source": "lecture",
   "id": "L05-m19"
  },
  {
   "q": "What does `W<int>::v`, `W<char*>::v`, `W<int*>::v`, `W<const int*>::v` print, in order?\n    template<class T> struct W       { static constexpr int v = 0; };\n    template<class T> struct W<T*>   { static constexpr int v = 1; };\n    template<>        struct W<int*> { static constexpr int v = 2; };",
   "options": [
    "0111",
    "0122",
    "0121",
    "0221"
   ],
   "answer": 2,
   "explanation": "int matches only the primary (0); char* matches the partial T* (1); int* matches the full specialization exactly (2); const int* is not int*, so it takes the partial T* with T = const int (1).",
   "distractors": "`const int*` is a different type from `int*`, so the full specialization doesn't apply to it.",
   "source": "lecture",
   "id": "L05-m20"
  },
  {
   "q": "In the templatized order-posting design `template<typename Venue> void postOrder(Venue& v, const Order& o) { v.send(o); }`, what happens if a type without a `send` member is passed?",
   "options": [
    "It compiles and throws at runtime",
    "The call silently does nothing",
    "Compile error at instantiation, because `v.send` doesn't exist for that type",
    "The linker reports an undefined symbol"
   ],
   "answer": 2,
   "explanation": "Dependent expressions are checked when the template is instantiated; a missing member is a compile-time error (C++20 concepts can make the message clearer).",
   "distractors": "Templates have no runtime lookup, so nothing can throw or silently no-op; the failure happens before linking.",
   "source": "lecture",
   "id": "L05-m21"
  },
  {
   "q": "What does `cnt(1, 'a', 2.0, \"s\")` return?\n    template<class... Ts> constexpr auto cnt(Ts...) { return sizeof...(Ts); }",
   "options": [
    "4",
    "1",
    "16",
    "Compile error: the pack is unnamed"
   ],
   "answer": 0,
   "explanation": "`sizeof...(Ts)` is the number of elements in the pack (4), computed at compile time, not a size in bytes.",
   "distractors": "16 confuses it with sizeof; pack parameters don't need names.",
   "source": "lecture",
   "id": "L05-m22"
  },
  {
   "q": "Why can marking a class `final` speed up calls like `obj.price()` on `Derived& obj`, where `price` is virtual?",
   "options": [
    "`final` removes the vptr from the object",
    "`final` makes all member functions inline by definition",
    "`final` moves the vtable into L1 cache",
    "No further override can exist, so the compiler can devirtualize the call into a direct (inlinable) call"
   ],
   "answer": 3,
   "explanation": "If the static type is a final class, the final overrider is known at compile time, so the indirect call becomes a direct one.",
   "distractors": "The vptr is still there (the class is polymorphic); `final` doesn't control inlining or cache placement.",
   "source": "lecture",
   "id": "L05-m23"
  },
  {
   "q": "Which loop makes a full copy of every `std::pair<const int, Level>` while iterating a `std::map<int, Level> book`?",
   "options": [
    "`for (const auto& kv : book)`",
    "`for (const std::pair<int, Level>& kv : book)`",
    "`for (auto& kv : book)`",
    "`for (auto&& kv : book)`"
   ],
   "answer": 1,
   "explanation": "The element type is `std::pair<const int, Level>`; binding to `const std::pair<int, Level>&` needs a conversion, so a temporary copy is created for each element.",
   "distractors": "The auto forms deduce the exact element type and bind directly with no copy.",
   "source": "lecture",
   "id": "L05-m24"
  },
  {
   "q": "`const int limit = 10; int* p = const_cast<int*>(&limit); *p = 20;` What is this?",
   "options": [
    "Fine: const_cast exists for exactly this",
    "Undefined behaviour: modifying an object defined const",
    "Compile error",
    "Always prints 20 afterwards"
   ],
   "answer": 1,
   "explanation": "const_cast only removes const from the type; writing to an object that was *defined* const is UB (it may sit in read-only memory or be constant-folded).",
   "distractors": "It compiles, and the compiler may well keep using 10, so neither 'fine' nor 'prints 20' is guaranteed.",
   "source": "lecture",
   "id": "L05-m25"
  }
 ],
 "msqs": [
  {
   "q": "Which statements about function templates are true? (select all that apply)",
   "options": [
    "Template definitions normally go in headers so they can be instantiated in every translation unit",
    "An uninstantiated template generates no machine code",
    "Each distinct set of template arguments produces a separate instantiation",
    "Function templates can be partially specialized",
    "Template dispatch adds an indirect call at runtime"
   ],
   "answers": [
    0,
    1,
    2
   ],
   "explanation": "Templates are instantiated per argument set, emit code only when used, and need their definitions visible (headers). Partial specialization is only for class/variable templates, and template calls are direct, not indirect.",
   "id": "L05-x1"
  },
  {
   "q": "For `template<class T> void f(T&& p);`, which deductions are correct? (select all that apply)",
   "options": [
    "`f(42);` gives T = int",
    "`int x; f(x);` gives T = int&",
    "`const int c = 1; f(c);` gives T = const int&",
    "`f(42);` gives T = int&&"
   ],
   "answers": [
    0,
    1,
    2
   ],
   "explanation": "Lvalues make T an lvalue reference (keeping const); rvalues make T the plain type and the parameter becomes int&&. T itself is never deduced as int&& for a prvalue argument.",
   "id": "L05-x2"
  },
  {
   "q": "Which declarations deduce exactly `int` (not a reference, not const)? (select all that apply)",
   "options": [
    "`const int cx = 1; auto& d = cx;`",
    "`int& r = x; auto b = r;`",
    "`const int cx = 1; auto a = cx;`",
    "`auto c{5};`",
    "`auto e = {5};`"
   ],
   "answers": [
    1,
    2,
    3
   ],
   "explanation": "By-value auto drops references and top-level const, and since C++17 `auto c{5}` is int. `auto&` keeps const (const int&), and `auto e = {5}` is std::initializer_list<int>.",
   "id": "L05-x3"
  },
  {
   "q": "Which are true about vtables and vptrs on a typical x86-64 compiler? (select all that apply)",
   "options": [
    "Each object of a polymorphic class holds a hidden vptr (8 bytes)",
    "Adding a fifth virtual function increases sizeof every object by 8",
    "The vtable is allocated on the heap when the first object is created",
    "There is one vtable per polymorphic class, not per object",
    "During the base-class constructor, the vptr points to the base class's vtable"
   ],
   "answers": [
    0,
    3,
    4
   ],
   "explanation": "The vtable is static per class (in read-only data) and each object carries a single vptr, which the base constructor sets to the base vtable. More virtual functions grow the vtable, not the objects; there's no heap allocation.",
   "id": "L05-x4"
  },
  {
   "q": "Which of these are undefined behaviour? (select all that apply)",
   "options": [
    "`std::bit_cast<uint64_t>(d)` for a double d",
    "`delete basePtr;` when Base's destructor is non-virtual and the object is a Derived",
    "Reading a `double` through `*reinterpret_cast<uint64_t*>(&d)`",
    "`dynamic_cast<Limit*>(basePtr)` when basePtr points to a Market",
    "`static_cast<Limit*>(basePtr)->px` when basePtr actually points to a Market"
   ],
   "answers": [
    1,
    2,
    4
   ],
   "explanation": "Non-virtual polymorphic delete, an unchecked wrong downcast, and a strict-aliasing violation are all UB. dynamic_cast safely returns nullptr, and bit_cast is the well-defined way to copy bits.",
   "id": "L05-x5"
  },
  {
   "q": "Which reasons explain why a virtual call in a hot loop can be slower than a template/CRTP call? (select all that apply)",
   "options": [
    "It needs dependent loads: vptr, then the function pointer",
    "Virtual calls acquire a lock on the vtable",
    "Virtual calls always perform a system call",
    "The compiler usually cannot inline across it",
    "An indirect branch can be mispredicted when types are mixed"
   ],
   "answers": [
    0,
    3,
    4
   ],
   "explanation": "The costs are lost inlining, two dependent loads that may miss in cache, and indirect-branch misprediction (~15–20 cycles). No syscalls or locks are involved.",
   "id": "L05-x6"
  },
  {
   "q": "Which statements about CRTP are true? (select all that apply)",
   "options": [
    "CRTP is resolved by RTTI at runtime",
    "`Base<A>` and `Base<B>` share a common runtime type so they fit in one `vector<Base*>`",
    "Dispatch uses `static_cast<Derived*>(this)`",
    "Objects carry no vptr because of CRTP",
    "The derived class inherits from `Base<Derived>`"
   ],
   "answers": [
    2,
    3,
    4
   ],
   "explanation": "CRTP is compile-time polymorphism: `class D : Base<D>`, static_cast to the derived type, and no vtable. Different instantiations are unrelated types, and no RTTI is involved.",
   "id": "L05-x7"
  },
  {
   "q": "Which fold expressions are well-formed when the pack `ts` is EMPTY? (select all that apply)",
   "options": [
    "`(ts || ...)`",
    "`(ts && ...)`",
    "`(ts * ...)`",
    "`(ts + ...)`",
    "`(ts + ... + 0)`"
   ],
   "answers": [
    0,
    1,
    4
   ],
   "explanation": "Empty unary folds are allowed only for &&, || and the comma operator (true, false, void()). A binary fold with an initial value always works. Unary + or * over an empty pack is ill-formed.",
   "id": "L05-x8"
  },
  {
   "q": "Which statements about template specialization are true? (select all that apply)",
   "options": [
    "An explicit specialization of a function template takes part in overload resolution as an independent overload",
    "Class templates support both full and partial specialization",
    "`template<> struct Fact<0>` is a partial specialization",
    "`std::vector<bool>` is a standard specialization whose `operator[]` returns a proxy",
    "Overload resolution first picks among primary templates, then looks at their specializations"
   ],
   "answers": [
    1,
    3,
    4
   ],
   "explanation": "Class templates allow both kinds; function specializations are only considered after their primary template wins; vector<bool> uses a proxy. `template<>` with every argument fixed is a full specialization, not a partial one.",
   "id": "L05-x9"
  },
  {
   "q": "Given `int x = 0; const int& cr = x;`, which are `int&`? (select all that apply)",
   "options": [
    "the return type of `decltype(auto) f() { return (g_int); }` where g_int is a global int",
    "`decltype(cr)`",
    "`decltype((x))`",
    "`decltype(x)`"
   ],
   "answers": [
    0,
    2
   ],
   "explanation": "Parenthesized lvalue expressions give T&, so both (x) and (g_int) give int&. `decltype(x)` is the declared type int, and `decltype(cr)` is const int&, not int&.",
   "id": "L05-x10"
  },
  {
   "q": "Which are true about constexpr / consteval / constinit? (select all that apply)",
   "options": [
    "A constinit variable is implicitly const",
    "UB inside a constant evaluation makes it fail to compile",
    "A constexpr function can also be called with runtime arguments",
    "A consteval function must be evaluated at compile time on every call",
    "`if constexpr` discards the untaken branch at compile time"
   ],
   "answers": [
    1,
    2,
    3,
    4
   ],
   "explanation": "constexpr functions are allowed (not forced) at compile time, consteval is forced, constant evaluation rejects UB, and if constexpr drops the other branch. constinit only guarantees compile-time initialization; the variable stays mutable.",
   "id": "L05-x11"
  },
  {
   "q": "Which statements about dynamic_cast are true? (select all that apply)",
   "options": [
    "It has zero runtime cost",
    "A failed cast to a pointer type returns the original pointer unchanged",
    "A failed cast to a reference type throws std::bad_cast",
    "It relies on RTTI and is disabled by -fno-rtti",
    "It requires a polymorphic source type for downcasts"
   ],
   "answers": [
    2,
    3,
    4
   ],
   "explanation": "dynamic_cast walks RTTI at runtime, so it costs tens to hundreds of ns and needs RTTI enabled and a polymorphic type. A failed pointer cast returns nullptr, not the original pointer.",
   "id": "L05-x12"
  },
  {
   "q": "In the class memory-pool idea (one huge chunk allocated at startup, objects carved out of it), which practices are correct? (select all that apply)",
   "options": [
    "Reinterpret an existing `D` object as an unrelated struct `C` and read its fields",
    "Make sure each slot is aligned to `alignof(Order)`",
    "Allocate once at startup so the hot path never calls `new`",
    "Use placement new to begin each Order's lifetime in the chunk",
    "Call `delete` on each Order carved from the chunk"
   ],
   "answers": [
    1,
    2,
    3
   ],
   "explanation": "A pool pre-allocates once, aligns slots and constructs objects with placement new. Reading a D through a C* breaks strict aliasing, and objects from placement new must be destroyed with an explicit destructor call (then the slot is reused), never with delete.",
   "id": "L05-x13"
  }
 ],
 "short": [
  {
   "q": "Explain why a polymorphic base class needs a virtual destructor. Show the bug and the fix.",
   "checks": [
    {
     "label": "Deleting through a base pointer",
     "patterns": [
      "base\\s*(class\\s*)?(pointer|\\*)",
      "delete\\s+\\w+.*base",
      "through (a|the) base"
     ]
    },
    {
     "label": "Non-virtual means only the base destructor runs / UB",
     "patterns": [
      "undefined behaviou?r",
      "\\bUB\\b",
      "only[\\s\\S]{0,30}base[\\s\\S]{0,20}destructor"
     ]
    },
    {
     "label": "Derived resources leak / derived destructor skipped",
     "patterns": [
      "leak",
      "derived[\\s\\S]{0,30}(destructor|dtor)[\\s\\S]{0,30}(skipped|not (run|called)|never)",
      "never (runs|called)"
     ]
    },
    {
     "label": "Fix: declare the destructor virtual",
     "patterns": [
      "virtual\\s*~",
      "virtual destructor"
     ]
    }
   ],
   "modelAnswer": "When you `delete` an object through a **base pointer**, the compiler calls the destructor of the pointer's static type unless the destructor is **virtual**. If it isn't, the behaviour is **undefined behaviour**; in practice only `~Base` runs, the derived destructor never runs, and anything the derived class owns leaks.\n\n```cpp\nstruct Order { ~Order() {} };                 // bug: non-virtual\nstruct Iceberg : Order { std::vector<int> slices; };\nOrder* o = new Iceberg; delete o;             // UB: ~Iceberg skipped, vector leaks\n\nstruct Order2 { virtual ~Order2() = default; };   // fix: virtual destructor\n```\n\nWith `virtual ~Order2()`, `delete` goes through the vtable, runs `~Iceberg` and then `~Order2`. Cost: an 8-byte vptr per object (if the class had no virtuals already) and an indirect call on delete. If you never delete polymorphically, make the base destructor protected and non-virtual instead.",
   "explanation": "The examiner wants: delete via base pointer, UB / derived destructor not called, the leak, and the fix.",
   "id": "L05-s1"
  },
  {
   "q": "Write a minimal CRTP example for a trading strategy and explain why it's preferred over virtual functions on the hot path.",
   "checks": [
    {
     "label": "Base templated on Derived",
     "patterns": [
      "template\\s*<\\s*(typename|class)\\s+\\w+\\s*>\\s*(struct|class)",
      "Base\\s*<\\s*\\w+\\s*>"
     ]
    },
    {
     "label": "static_cast to Derived",
     "patterns": [
      "static_cast\\s*<\\s*\\w+\\s*\\*\\s*>\\s*\\(\\s*this\\s*\\)"
     ]
    },
    {
     "label": "Derived inherits from Base<Derived>",
     "patterns": [
      ":\\s*(public\\s+)?\\w+\\s*<\\s*\\w+\\s*>"
     ]
    },
    {
     "label": "Compile-time dispatch / inlining",
     "patterns": [
      "compile[- ]time",
      "inlin",
      "static (dispatch|polymorphism)"
     ]
    },
    {
     "label": "No vtable / vptr / indirect call",
     "patterns": [
      "no (vtable|vptr|virtual|indirect)",
      "without (a )?(vtable|vptr|indirect)"
     ]
    }
   ],
   "modelAnswer": "```cpp\ntemplate <typename Derived>\nstruct Strategy {\n    void onTick(const Tick& t) { static_cast<Derived*>(this)->onTickImpl(t); }\n};\nstruct Momentum : public Strategy<Momentum> {\n    void onTickImpl(const Tick& t) { /* signal */ }\n};\n```\n\nThe base is a template over the derived class, and `static_cast<Derived*>(this)` is resolved at **compile time**, so `onTick` becomes a direct call that the compiler can **inline**, constant-fold and vectorise around. There's no vtable, no vptr in the object and no indirect branch to mispredict. That matters in a loop running millions of times per second. The cost: each strategy is a separate type (no `vector<Strategy*>`) and you get one copy of the code per type.",
   "explanation": "Show the pattern correctly and state compile-time dispatch, inlining and no vtable/indirect call.",
   "id": "L05-s2"
  },
  {
   "q": "State Scott Meyers' three template type deduction cases for `template<class T> void f(ParamType p)` and give `T` for `const int cx = 0; f(cx);` in each case.",
   "checks": [
    {
     "label": "Reference/pointer case keeps const",
     "patterns": [
      "T\\s*&(?!&)[\\s\\S]{0,80}const int",
      "reference[\\s\\S]{0,60}(keeps|keep|preserv)[\\s\\S]{0,20}const"
     ]
    },
    {
     "label": "Universal reference with lvalue gives T as lvalue reference",
     "patterns": [
      "const int\\s*&",
      "lvalue reference"
     ]
    },
    {
     "label": "By value drops reference and top-level const",
     "patterns": [
      "(drops?|strip|remov|ignor)[\\s\\S]{0,40}const",
      "T\\s*=\\s*int\\b"
     ]
    },
    {
     "label": "Mentions reference collapsing or universal/forwarding reference",
     "patterns": [
      "collaps",
      "universal",
      "forwarding"
     ]
    }
   ],
   "modelAnswer": "1. **ParamType is a reference/pointer (`T&`):** ignore the argument's reference, pattern-match, and const is kept. `f(T& p)` with `cx`: `T = const int`, `p` is `const int&`.\n2. **ParamType is a universal (forwarding) reference (`T&&`):** an lvalue argument deduces `T` as an **lvalue reference**; reference collapsing turns `T&& ` into `T&`. With `cx`: `T = const int&`, `p` is `const int&`. (For an rvalue like `f(0)`, `T = int`, `p` is `int&&`.)\n3. **By value (`T`):** `p` is a fresh copy, so drop the reference and then **drop top-level const/volatile**. With `cx`: `T = int`.\n\nArrays and functions decay to pointers in case 3 but not in case 1.",
   "explanation": "Name the three cases correctly with the const behaviour and the lvalue-reference rule for T&&.",
   "id": "L05-s3"
  },
  {
   "q": "Write a compile-time factorial using template specialization, and say what code ends up in the binary for `Fact<10>::value`.",
   "checks": [
    {
     "label": "Primary recursive template",
     "patterns": [
      "Fact\\s*<\\s*N\\s*-\\s*1\\s*>"
     ]
    },
    {
     "label": "Full specialization base case",
     "patterns": [
      "template\\s*<\\s*>\\s*struct\\s+Fact\\s*<\\s*0\\s*>"
     ]
    },
    {
     "label": "static constexpr value",
     "patterns": [
      "static\\s+constexpr"
     ]
    },
    {
     "label": "Result is a compile-time constant, no runtime computation",
     "patterns": [
      "compile[- ]time constant",
      "no runtime",
      "immediate",
      "constant (is )?(baked|folded|embedded)"
     ]
    }
   ],
   "modelAnswer": "```cpp\ntemplate <unsigned N>\nstruct Fact { static constexpr unsigned long long value = N * Fact<N - 1>::value; };\n\ntemplate <>\nstruct Fact<0> { static constexpr unsigned long long value = 1; };   // base case\n\nstatic_assert(Fact<10>::value == 3628800);\n```\n\nThe compiler instantiates `Fact<10>`, `Fact<9>` … `Fact<0>` and stops at the full specialization. `Fact<10>::value` is a **compile-time constant**, so the binary just contains the immediate `3628800` (e.g. `mov eax, 3628800`). There's no runtime loop or call. A `constexpr` function does the same job more readably in modern C++.",
   "explanation": "They want the recursion, the full specialization base case and the point that it is folded to a constant.",
   "id": "L05-s4"
  },
  {
   "q": "Compare `static_cast`, `dynamic_cast` and `reinterpret_cast`: when each is checked, the cost, and one valid use of each.",
   "checks": [
    {
     "label": "static_cast is compile time / unchecked downcast",
     "patterns": [
      "static_cast[\\s\\S]{0,120}compile[- ]time",
      "static_cast[\\s\\S]{0,120}(unchecked|no runtime)"
     ]
    },
    {
     "label": "dynamic_cast uses runtime RTTI",
     "patterns": [
      "dynamic_cast[\\s\\S]{0,120}(run[- ]?time|RTTI)"
     ]
    },
    {
     "label": "dynamic_cast failure: nullptr or bad_cast",
     "patterns": [
      "nullptr",
      "bad_cast"
     ]
    },
    {
     "label": "reinterpret_cast reinterprets bits, aliasing danger",
     "patterns": [
      "reinterpret_cast[\\s\\S]{0,160}(bits|alias|unrelated)"
     ]
    },
    {
     "label": "Needs a polymorphic type",
     "patterns": [
      "polymorphic",
      "virtual"
     ]
    }
   ],
   "modelAnswer": "- **static_cast** is checked at **compile time** only, with no runtime cost. Uses: numeric conversions (`static_cast<int>(px * 100)`), upcasts, `void*` to `T*`, `std::move` (a cast to `T&&`). A downcast is **unchecked**: wrong type = UB.\n- **dynamic_cast** checks at **runtime** using **RTTI**, and needs a **polymorphic** type (at least one virtual function). A failed pointer cast returns `nullptr`; a failed reference cast throws `std::bad_cast`. It costs tens to hundreds of ns, so keep it off the hot path. Use: safely downcasting a `Base*` from a plugin interface.\n- **reinterpret_cast** does no checks: it reinterprets the bits/pointer as an unrelated type. Uses: pointer to `uintptr_t` for alignment checks, viewing a buffer as `std::byte*`. Dereferencing an object through an unrelated type breaks **strict aliasing** (UB); use `memcpy`/`std::bit_cast`, or placement new for a memory pool.",
   "explanation": "Check timing (compile vs runtime), the failure behaviour of dynamic_cast, and the aliasing warning for reinterpret_cast.",
   "id": "L05-s5"
  },
  {
   "q": "Predict the output and explain:\n    struct B { B() { hello(); } virtual void hello() { std::cout << \"B \"; } };\n    struct D : B { D() { hello(); } void hello() override { std::cout << \"D \"; } };\n    int main() { D d; }",
   "checks": [
    {
     "label": "Output is B D",
     "patterns": [
      "\\bB\\s+D\\b",
      "\\\"B D",
      "B then D"
     ]
    },
    {
     "label": "During B's constructor the dynamic type is B",
     "patterns": [
      "(dynamic type|object) is (still |only )?(a )?B\\b",
      "(vptr|vtable)[\\s\\S]{0,60}\\bB\\b",
      "not yet (constructed|a D)"
     ]
    },
    {
     "label": "Virtual dispatch doesn't reach the derived class in constructors",
     "patterns": [
      "(constructor|construction)[\\s\\S]{0,80}(not|doesn't|does not|never)[\\s\\S]{0,40}(derived|D\\b|dispatch)",
      "no (virtual )?dispatch to (the )?derived"
     ]
    }
   ],
   "modelAnswer": "Output: `B D`.\n\nWhile `B`'s constructor runs, the `D` part is not yet constructed, so the object's **dynamic type is B**: the vptr points to **B's vtable**. The virtual call in `B()` therefore does not dispatch to the derived override and calls `B::hello`. Then `D()` runs, the vptr is switched to D's vtable, and its call prints `D`. The same rule applies in destructors, in reverse order. (Calling a *pure* virtual this way is UB.)",
   "explanation": "The key insight: virtual calls inside a constructor resolve to the class being constructed.",
   "id": "L05-s6"
  }
 ],
 "quiz": [],
 "coding": [
  {
   "id": "constexpr-crtp",
   "title": "Compile-Time Tables and CRTP Dispatch"
  }
 ],
 "prev": {
  "num": 4,
  "file": "lecture-04.html"
 },
 "next": {
  "num": 6,
  "file": "lecture-06.html"
 }
};
