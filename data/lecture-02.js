window.PAGE = {
 "num": 2,
 "title": "Pointers and References",
 "summary": "Why C needs pointers, array decay and why it exists, and pass-by-value vs pointer vs reference, built around the class swap, fix_pointers and more_pointers exercises and the byte-reinterpretation demo. It then covers references as syntax sugar for pointers, inheritance and virtual dispatch, life without a GC (leaks, RAII), a first look at std::unique_ptr, and the classic memory-safety pitfalls.",
 "notes": [
  {
   "heading": "Why does C (and C++) need pointers?",
   "body": "A pointer is just an address: 8 bytes on x86-64 that say where an object lives. C was designed as a portable assembler, and pointers are how it exposes the machine's addressing.\n\n- **Avoid copying.** Passing an 8-byte address instead of a 4 KiB struct means one register instead of a 4 KiB `memcpy`.\n- **Let a function modify the caller's data.** C has only pass-by-value, so the only way to change a caller's variable is to pass its address (`swap(&x, &y)`).\n- **Dynamic memory.** `malloc` and `new` return the address of memory whose size and lifetime are decided at run time.\n- **Linked data structures.** Lists, trees, order-book levels and free lists all need one node to *refer* to another.\n- **Arrays and strings.** Arrays are passed as a pointer to their first element, and a C string is a `char*` to a NUL-terminated sequence.\n- **Talking to hardware and the OS.** Memory-mapped device registers, `mmap`ed files, shared-memory ring buffers between processes, and buffers handed to `recv()`.\n\n```cpp\nint x = 10;\nint* p = &x;         // p stores x's address\n*p += 1;             // x == 11\np + 1;               // address + sizeof(int) = +4 bytes (pointer arithmetic is scaled)\nvoid* v = p;         // untyped address: cannot be dereferenced or used in arithmetic\nconst int* a = &x;   // pointer to const int: *a = 1 is an error, a = nullptr is ok\nint* const b = &x;   // const pointer: *b = 1 is ok, b = nullptr is an error\n```\n\nRead declarations right to left: `const int* p` is \"p is a pointer to an int that is const\", and `int* const p` is \"p is a const pointer to an int\"."
  },
  {
   "heading": "Array decay to pointer, and why",
   "body": "In almost every expression, an array of `T` **decays** (is implicitly converted) to a pointer to its first element, `T*`.\n\n```cpp\nint a[4] = {1, 2, 3, 4};\nint* p = a;                 // same as &a[0]\nstd::cout << *(a + 2);      // 3: a[i] is defined as *(a + i)\nvoid f(int arr[]);          // the parameter is really int* arr\nvoid g(int arr[100]);       // still int*: the 100 is ignored\nsizeof(a);                  // 16: no decay here\n&a;                         // type int(*)[4]: pointer to the whole array, no decay\n```\n\n**Where it does not decay:** `sizeof(a)`, `&a`, `decltype(a)`, binding to a reference `int (&r)[4] = a;`, and a string literal initialising a `char` array.\n\n**Why C does this.** It is a design choice from C's ancestor B, where an array name *was* a pointer. Dennis Ritchie kept the behaviour so that:\n\n1. Passing an array costs one register (the address) instead of copying the whole array on every call. In 1972, copying arrays by value would have been ruinous.\n2. Array indexing and pointer arithmetic are the same operation (`a[i] == *(a+i)`), which maps directly onto the machine's `base + index*scale` addressing mode.\n\n**The cost** is that the size is lost. Inside the callee, `sizeof(arr)` is 8 and the length must travel separately: the classic source of buffer overflows. Modern fixes:\n\n```cpp\nvoid f(int* data, size_t n);              // C style: pass the length\ntemplate <size_t N> void f(int (&a)[N]);  // reference to array: N is deduced\nvoid f(std::span<const int> s);           // C++20: pointer + length in one view\nvoid f(const std::array<int, 4>& a);      // std::array never decays\n```"
  },
  {
   "heading": "Pass by value vs by pointer vs by reference",
   "body": "```cpp\nvoid byValue(int x)      { x = 99; }   // modifies a copy: the caller is unchanged\nvoid byPointer(int* x)   { *x = 99; }  // caller passes &v: the caller is changed\nvoid byRef(int& x)       { x = 99; }   // caller passes v: the caller is changed\nvoid readOnly(const Order& o);         // no copy and no modification: the idiom for big types\n```\n\n**In class (`Lec-3/swap.cpp`):** the canonical pointer exercise.\n\n```cpp\nvoid swap(int* ptrX, int* ptrY) {\n    int temp = *ptrX;   // 10\n    *ptrX = *ptrY;\n    *ptrY = temp;\n}\nint x = 10, y = 20;\nswap(&x, &y);           // prints \"10 20\" then \"20 10\"\n```\n\nA `swap(int a, int b)` by value would swap copies and print `10 20` twice.\n\n| | By value | By pointer | By reference |\n|---|---|---|---|\n| Copies the object | yes | no (copies 8 B address) | no |\n| Can modify the caller | no | yes | yes (unless `const&`) |\n| Can be null | n/a | yes, so check it | no |\n| Call-site syntax | `f(v)` | `f(&v)`: explicit | `f(v)`: hidden |\n| Typical use | small types (`int`, `double`, small PODs ≤ 16 B) | optional output, C APIs | in-out parameters, `const&` for large types |\n\n**Performance rule of thumb:** pass small, trivially copyable types (≤ 2 registers, about 16 bytes) **by value**. They travel in registers, and the callee doesn't have to worry about aliasing. Pass anything large or expensive to copy (`std::string`, `std::vector`, big structs) by `const&`."
  },
  {
   "heading": "In class: swapping struct arrays (fix_pointers and more_pointers)",
   "body": "**In class (`Lec-2/fix_pointers.cpp`):** swap *only the `arr` member* of two `Child` objects through pointers.\n\n```cpp\nstruct Child { int id; int arr[4]; };        // sizeof(Child) == 20\n\nvoid swap(Child* a, Child* b) {              // swap only arr, element by element\n    int temp[4];\n    for (size_t i = 0; i < 4; i++) temp[i] = (*a).arr[i];  // (*a).arr is the same as a->arr\n    for (size_t i = 0; i < 4; i++) (*a).arr[i] = (*b).arr[i];\n    for (size_t i = 0; i < 4; i++) (*b).arr[i] = temp[i];\n}\nvoid print(Child obj);                       // BY VALUE: copies all 20 bytes per call\n\nChild a{1, {1,2,3,4}}, b{2, {1,1,1,0}};\nswap(&a, &b);\n// a: id 1 -> 1 1 1 0      b: id 2 -> 1 2 3 4    (the ids are untouched)\n```\n\n**In class (`Lec-6/more_pointers.cpp`):** the tempting shortcut that does **not** work.\n\n```cpp\nvoid swap(Child* a, Child* b) {\n    int* temp = (*a).arr;        // compiles: the array member decays to int*\n    // (*a).arr = (*b).arr;      // ERROR: arrays are not assignable\n    // (*b).arr = temp;          // ERROR\n}\n```\n\nAn array member is the 16 bytes of storage *inside* the object, not a pointer that could be re-pointed. You can't \"swap the arrays by swapping pointers\". You must move the bytes: with a loop, with `std::swap(a->arr, b->arr)` (the standard library has an array overload), with `std::memcpy`, or by making the member a `std::array<int,4>`, which *is* assignable.\n\nImprovements over the class code: `print` should take `const Child&` to avoid the copy, and `a->arr` is the idiomatic spelling of `(*a).arr`."
  },
  {
   "heading": "What a function call costs (calling convention)",
   "body": "**In class (`Lec-2/main.cpp`):** `int add(int x, int y) { return x + y; }` called as `add(12, 13)`, then inspected in assembly.\n\nThe System V x86-64 ABI (Linux) passes the first six integer or pointer arguments in **`rdi, rsi, rdx, rcx, r8, r9`** (floating point in `xmm0–7`) and returns in **`rax`** (or `xmm0`).\n\n```asm\n; -O0: everything is spilled to the stack\nadd:  push rbp\n      mov  rbp, rsp\n      mov  DWORD PTR [rbp-4], edi    ; x\n      mov  DWORD PTR [rbp-8], esi    ; y\n      mov  edx, DWORD PTR [rbp-4]\n      mov  eax, DWORD PTR [rbp-8]\n      add  eax, edx\n      pop  rbp\n      ret\nmain: mov  esi, 13\n      mov  edi, 12\n      call add\n\n; -O2\nadd:  lea  eax, [rdi+rsi]            ; one instruction\n      ret\nmain: xor  eax, eax                  ; the unused call is removed entirely\n      ret\n```\n\n- A call that is not inlined costs a `call`/`ret` pair, possible register spills and lost optimisation across the boundary. Each costs only a few cycles, but inlining enables everything else (constant folding, vectorisation).\n- A **pointer or reference parameter** means the value is in memory, and the compiler must assume it may alias other pointers. That can block keeping it in a register, another reason small things go by value."
  },
  {
   "heading": "References: syntax sugar for pointers",
   "body": "```cpp\nint x = 1;\nint& r = x;     // r is another name for x\nr = 5;          // x == 5\nint* p = &r;    // &r == &x: a reference has no separate identity\nint& bad;       // ERROR: a reference must be initialised\n// there is no null reference and no way to reseat one: `r = y;` assigns y's VALUE to x\n```\n\n- **Under the hood**, a reference parameter or member is usually implemented exactly like a `T* const` that is auto-dereferenced. `void f(int& r)` and `void f(int* const p)` compile to the same assembly. That is the sense of \"syntax sugar for pointers\".\n- **What it adds:** it cannot be null, must be bound once, cannot be reseated and needs no `*`/`->`. That makes it safer for \"this argument must exist\".\n- `sizeof(r)` is `sizeof(int)` (the referred type), and you cannot have arrays of references or pointers to references.\n- `const T&` can bind to temporaries and extends their lifetime: `const std::string& s = std::string(\"hi\");` is valid.\n- **Dangling references** are as dangerous as dangling pointers:\n\n```cpp\nint& bad() { int local = 3; return local; }   // returns a reference to a dead stack slot: UB\n```\n\n| | Pointer `T*` | Reference `T&` |\n|---|---|---|\n| Can be null | yes | no |\n| Can be reseated | yes | no |\n| Must be initialised | no | yes |\n| Arithmetic | yes | no |\n| Syntax | `*p`, `p->m` | as the object itself |"
  },
  {
   "heading": "In class: reinterpreting bytes (type punning and endianness)",
   "body": "**In class (`Lec-3/main.cpp`):** build the bytes of `A = 1000` and `B = 2000` manually into an `int8_t bytes[8]`, then view those bytes as a `struct Cordinate { int x; int y; }`.\n\n```cpp\nint8_t bytes[8];\n// for each int: byte i (bits i*8 .. i*8+7) is written to bytes[var*4 + i]\nf(0, A);  f(1, B);\nvoid* ptr = bytes;\nCordinate* c = (Cordinate*)ptr;\nstd::cout << c->x << '\\n' << c->y;   // prints 1000 and 2000 on x86\n```\n\nWhat the example teaches:\n\n- **Memory is just bytes, and the type decides how they are read.** 8 raw bytes = 2 ints = 1 `Cordinate`, because `sizeof(Cordinate) == 8` with no padding.\n- **Endianness.** The code puts the *least significant* byte at the lowest address. 1000 = `0x000003E8`, so the bytes are `E8 03 00 00`. That is exactly how x86 (little-endian) stores an `int`, so it reads back as 1000. On a big-endian machine it would print a different number. Network protocols are big-endian, hence `htonl`/`ntohl`.\n\nWhat is formally wrong with it (say this in the exam):\n\n1. **Strict aliasing.** Reading an `int8_t` array *through* a `Cordinate*` is UB. `char` and `std::byte` may alias anything, but not the reverse. GCC at `-O2` may reorder or drop such accesses.\n2. **Alignment.** `bytes` is only guaranteed 1-byte alignment, while `int` needs 4. x86 tolerates misaligned loads, but other CPUs may fault.\n3. `1 << 31` (when `i = 3, j = 7`) overflows a signed `int`: UB before C++20 (it is defined as `INT_MIN` in C++20).\n\nThe correct way to reinterpret bytes:\n\n```cpp\nCordinate c;\nstd::memcpy(&c, bytes, sizeof c);                 // well defined; compiles to one 8-byte load\nauto c2 = std::bit_cast<Cordinate>(raw8);         // C++20, raw8 is e.g. std::array<std::byte,8>\n```\n\nThis pattern (raw network bytes into a struct) is exactly how market-data feed handlers decode packets, so learn the safe version."
  },
  {
   "heading": "Inheritance and virtual functions",
   "body": "```cpp\nstruct Order {                         // base class\n    int64_t id; int32_t qty;\n    virtual double notional() const { return 0; }\n    virtual ~Order() = default;         // REQUIRED when deleting through Order*\n};\nstruct LimitOrder : public Order {      // derived: \"is-a\" Order\n    double px;\n    double notional() const override { return px * qty; }\n};\n\nOrder* o = new LimitOrder{};\no->notional();     // dynamic dispatch: calls LimitOrder::notional\ndelete o;          // OK only because ~Order is virtual\n```\n\n- **Non-virtual** call: the target is known at compile time (a direct `call` that can be inlined). **Virtual** call: the object holds a hidden **vptr** (8 bytes) pointing to its class's **vtable** (an array of function pointers). The call is `load vptr, then load slot, then indirect call`.\n- The cost of a virtual call is two dependent loads (likely cache hits), an indirect branch that can be mispredicted (about 15–20 cycles if it is), and above all **no inlining**. In a hot loop that is why HFT code prefers templates and CRTP (session 5).\n- Polymorphism works only through **pointers or references**. Passing by value **slices** the object: `void f(Order o)` copies only the `Order` part, and `o.notional()` calls `Order::notional`.\n- `override` asks the compiler to check that you really override something. `final` forbids further overriding and lets the compiler devirtualise.\n- Deleting a derived object through a base pointer **without a virtual destructor is UB** (in practice the derived destructor never runs and its resources leak).\n- `sizeof`: `struct B { virtual void f(); int x; };` is 16 bytes (8-byte vptr, 4-byte int, 4 bytes of padding)."
  },
  {
   "heading": "No GC: memory leaks and RAII",
   "body": "C++ has **no garbage collector**. Heap memory obtained with `new` lives until *you* `delete` it.\n\n**In class (`Lec-7/program.cpp`):**\n\n```cpp\nstruct Person {\n    int id, age, marks;\n    Person(int a, int b, int c) : id(a), age(b), marks(c) {}\n    ~Person() { std::cout << id << \" Person delete\\n\"; }\n};\nvoid f() { Person* p = new Person(1, 12, 0); }  // the pointer dies, the object does not\n// The output is EMPTY: the destructor never runs. That is a memory leak.\nvoid g() { Person person{1, 12, 0}; }           // stack object: prints \"1 Person delete\" at the closing brace\n```\n\n- A **leak** is memory that is still allocated but no longer reachable. In a process that runs all day (a trading engine), a leak in a per-order path grows without bound until the process is killed for running out of memory. The OS reclaims everything only at process exit.\n- **RAII** (Resource Acquisition Is Initialisation): tie each resource to an object whose destructor releases it. Destructors run deterministically at scope exit, including during exception unwinding. `std::vector`, `std::string`, `std::unique_ptr`, `std::lock_guard` and `std::fstream` are all RAII.\n- Rule: **no naked `new`/`delete` in application code.** Use containers and smart pointers.\n- Tools: `valgrind --leak-check=full ./a.out`, or `-fsanitize=address` (AddressSanitizer with LeakSanitizer)."
  },
  {
   "heading": "Smart pointers: introduction and basic unique_ptr",
   "body": "```cpp\n#include <memory>\nauto p = std::make_unique<Order>(42, 100);   // C++14: allocate and construct\np->qty = 5;                                  // use it like a raw pointer\nstd::unique_ptr<Order> q = std::move(p);     // ownership MOVES: p is now nullptr\n// std::unique_ptr<Order> r = q;             // ERROR: copy constructor is deleted\nOrder* raw = q.get();                        // observe without owning (never delete it)\nq.reset();                                   // deletes the Order now; q == nullptr\nauto arr = std::make_unique<int[]>(1024);    // array form: uses delete[]\n```\n\n- `std::unique_ptr<T>` = **sole ownership**. It deletes the object in its destructor, it is **move-only**, and with the default deleter it is **the same size as a raw pointer (8 B)**, with zero run-time overhead: it is a raw pointer with a destructor.\n- `release()` gives up ownership and returns the raw pointer **without deleting** it (the caller must now delete it). `reset(p)` deletes the old object and takes `p`.\n- A custom deleter (`std::unique_ptr<FILE, decltype(&fclose)>`) is a function pointer stored inside, which makes the `unique_ptr` 16 B. A stateless lambda deleter keeps it at 8 B.\n- Pass ownership by value (`void take(std::unique_ptr<Order> o)` with `take(std::move(p))`). Pass access by `T&` or `T*`.\n- `std::shared_ptr<T>`: shared ownership with an atomic reference count in a separate control block, so it is 16 B plus the control block, and copying costs an atomic increment. `std::weak_ptr` is a non-owning observer that breaks cycles. More in sessions 6–7.\n- Prefer `make_unique`/`make_shared` to `new`: they are exception-safe and `make_shared` does a single allocation."
  },
  {
   "heading": "Memory safety pitfalls",
   "body": "| Bug | Example | Typical symptom |\n|---|---|---|\n| Dangling pointer or use-after-free | `delete p; p->qty = 1;` | silent corruption, crash much later |\n| Returning the address of a local | `int* f(){ int x; return &x; }` | garbage values |\n| Double free | `delete p; delete p;` | heap corruption, abort from glibc (\"double free detected\") |\n| Mismatched new and delete | `int* a = new int[n]; delete a;` | UB (wrong destructor count) |\n| Buffer overflow | `char b[8]; strcpy(b, \"too long string\");` | stack smashing, security holes |\n| Uninitialised pointer | `int* p; *p = 3;` | writes to a random address |\n| Null dereference | `Order* o = find(id); o->qty;` | segfault |\n| Memory leak | `new` without `delete` | resident memory grows over time |\n| Iterator or pointer invalidation | pointer into a vector, then `push_back` | stale address after reallocation |\n\n**In class (`Lec-6/heap_memory.cpp`):** `int* arr = new int[1024*2024]; delete arr;`. This is a mismatched pair: memory from `new[]` must be released with `delete[]`. With `int` it happens to \"work\" on glibc, but it is UB, and with a class type it skips destructors or corrupts the heap.\n\nDefences: RAII (containers, `unique_ptr`), set pointers to `nullptr` after manual deletion, `std::span` and `.at()` in debug builds, compile with `-Wall -Wextra -fsanitize=address,undefined` in testing, and run `valgrind`."
  },
  {
   "heading": "Quick revision",
   "body": "- A pointer is an address (8 B). `&x` takes an address, `*p` dereferences, and `p + 1` moves by `sizeof(T)`.\n- C needs pointers to avoid copies, to modify caller data, for dynamic memory and linked structures, and for hardware access.\n- An array decays to a pointer to its first element in most expressions. The exceptions are `sizeof`, `&`, `decltype` and reference binding.\n- Decay exists so arrays pass cheaply. The cost is that the length is lost, so use `std::span` or `std::array`.\n- `a[i] == *(a+i)`. A parameter `int a[10]` is really `int*`.\n- By value copies, by pointer passes an address and can be null, and by reference is an alias that can't be null.\n- Pass small trivially copyable types by value and big ones by `const&`.\n- System V ABI: arguments in rdi, rsi, rdx, rcx, r8, r9, and the return value in rax.\n- A reference must be initialised, can't be reseated or null, and is implemented like `T* const`.\n- Arrays are not assignable, so swap them element-wise or with `std::swap(a, b)`, or use `std::array`.\n- Reinterpreting bytes through a cast is UB (strict aliasing). Use `memcpy` or `std::bit_cast`.\n- x86 is little-endian: the LSB is at the lowest address.\n- A virtual call goes through the vptr, then the vtable, then an indirect call, and it prevents inlining.\n- A base class that is deleted polymorphically needs a virtual destructor.\n- Passing a derived object by value slices it.\n- There is no GC: every `new` needs exactly one matching `delete`, or use RAII.\n- `unique_ptr` is sole ownership, move-only, 8 B and zero overhead. Use `make_unique`.\n- `new[]` pairs with `delete[]`. Mixing them is UB."
  },
  {
   "heading": "Exam traps",
   "body": "- **`int& r = x; r = y;`** does not rebind `r`. It copies `y`'s value into `x`.\n- **`sizeof(arr)` inside a function** taking `int arr[]` is 8, not the array size.\n- **\"References are just pointers\"** is true for the implementation, but references cannot be null, reseated or used in arithmetic, and `sizeof(ref)` is the size of the referred type.\n- **Swapping by value** (`void swap(int a, int b)`) changes nothing for the caller.\n- **`(*a).arr = (*b).arr;`** does not compile, because arrays are not assignable. `int* t = a->arr;` compiles via decay but copies nothing.\n- **`const int* p` vs `int* const p`**: read right to left.\n- **Missing virtual destructor**: `Base* b = new Derived; delete b;` is UB.\n- **Object slicing**: `std::vector<Base>` holding `Derived` objects stores only the Base parts. Use `std::vector<std::unique_ptr<Base>>`.\n- **Calling a virtual function in a constructor** dispatches to the class being constructed, not to the derived override.\n- **`unique_ptr` copy** is a compile error. Use `std::move`, and the source becomes null.\n- **`p.release()`** does not free the object, and forgetting to delete the result leaks it.\n- **`delete arr` for `new int[n]`** is UB even if it seems to work.\n- **Casting a byte buffer to `Struct*`** is strict-aliasing UB and possibly misaligned. Use `memcpy`.\n- **`1 << 31`** on a 32-bit int is UB before C++20. Use `1u << 31`.\n- **Returning a reference or pointer to a local** is UB the moment the function returns."
  }
 ],
 "keyTerms": [
  {
   "term": "Pointer",
   "def": "An object holding the memory address of another object. 8 bytes on x86-64."
  },
  {
   "term": "Array decay",
   "def": "Implicit conversion of an array expression to a pointer to its first element (except with sizeof, &, decltype, references)."
  },
  {
   "term": "Pass by value",
   "def": "The callee gets its own copy of the argument, so changes do not affect the caller."
  },
  {
   "term": "Pass by reference",
   "def": "The callee receives an alias (T&) for the caller's object: no copy, and modifications are visible."
  },
  {
   "term": "Reference",
   "def": "An alias for an existing object. It must be initialised, can't be null or reseated, and is usually implemented as a const pointer."
  },
  {
   "term": "const T&",
   "def": "Read-only reference that avoids copying and can bind to temporaries (extending their lifetime)."
  },
  {
   "term": "Calling convention",
   "def": "The ABI rule for passing arguments and returns. System V x86-64: rdi, rsi, rdx, rcx, r8, r9, and rax for the return."
  },
  {
   "term": "Strict aliasing",
   "def": "The rule that an object may only be accessed through its own type (or char/std::byte). Violations are UB."
  },
  {
   "term": "Endianness",
   "def": "Byte order of multi-byte values. Little-endian (x86) stores the least significant byte at the lowest address."
  },
  {
   "term": "std::bit_cast",
   "def": "C++20 function that reinterprets the bytes of one trivially copyable type as another, without UB."
  },
  {
   "term": "vptr / vtable",
   "def": "A hidden per-object pointer to a per-class table of virtual function pointers, used for dynamic dispatch."
  },
  {
   "term": "Object slicing",
   "def": "Copying a derived object into a base object by value, losing the derived part and its overrides."
  },
  {
   "term": "Virtual destructor",
   "def": "Makes `delete base_ptr` run the derived destructor. Required for polymorphic deletion."
  },
  {
   "term": "Memory leak",
   "def": "Heap memory that is still allocated but no longer reachable, so it can never be freed."
  },
  {
   "term": "RAII",
   "def": "Resource Acquisition Is Initialisation: a resource's lifetime is bound to an object whose destructor releases it."
  },
  {
   "term": "std::unique_ptr",
   "def": "Move-only smart pointer with sole ownership. It deletes the object in its destructor and is zero overhead."
  },
  {
   "term": "make_unique",
   "def": "C++14 factory that allocates and constructs a T and returns a unique_ptr<T>, exception-safely."
  },
  {
   "term": "Dangling pointer",
   "def": "A pointer to memory that has been freed or to an object whose lifetime has ended."
  },
  {
   "term": "Use-after-free",
   "def": "Accessing memory after it has been deallocated: UB and a classic security bug."
  }
 ],
 "mcqs": [
  {
   "q": "Why does C need pointers to let a function modify a caller's variable?",
   "options": [
    "Because C passes every argument by value, so only a copy of the address lets the callee reach the original",
    "Because C variables are global by default",
    "Because the stack is read-only in C",
    "Because C passes arguments by reference already"
   ],
   "answer": 0,
   "explanation": "C has only pass-by-value. Passing &x copies the address, and dereferencing it writes to the caller's object.",
   "distractors": "C has no references at all, and stack and global storage are unrelated to the reason.",
   "source": "lecture",
   "id": "L02-m1"
  },
  {
   "q": "What does the class swap program print?\n\n    void swap(int* ptrX, int* ptrY) { int temp = *ptrX; *ptrX = *ptrY; *ptrY = temp; }\n    int x = 10, y = 20;\n    std::cout << x << \" \" << y << '\\n';\n    swap(&x, &y);\n    std::cout << x << \" \" << y;",
   "options": [
    "10 20 / 10 20",
    "20 10 / 20 10",
    "10 20 / 20 10",
    "Compile error: std::swap ambiguity"
   ],
   "answer": 2,
   "explanation": "The first line prints the originals. swap writes through the pointers, so the second line shows them exchanged.",
   "distractors": "A by-value swap would leave 10 20 twice. With `int*` parameters there is no ambiguity with std::swap(T&, T&).",
   "source": "lecture",
   "id": "L02-m2"
  },
  {
   "q": "Which expression does NOT cause `int a[4]` to decay to a pointer?",
   "options": [
    "a + 1",
    "sizeof(a)",
    "int* p = a;",
    "f(a) where f takes int*"
   ],
   "answer": 1,
   "explanation": "sizeof is one of the exceptions (along with &, decltype and reference binding), so sizeof(a) is 16.",
   "distractors": "Arithmetic, initialising a pointer and passing to a function all decay.",
   "source": "lecture",
   "id": "L02-m3"
  },
  {
   "q": "What is the type of `&a` for `int a[4];`?",
   "options": [
    "int*",
    "int**",
    "int&",
    "int (*)[4]"
   ],
   "answer": 3,
   "explanation": "& is an exception to decay. It yields a pointer to the whole array, so &a + 1 advances 16 bytes.",
   "distractors": "int* is the type of a after decay (&a[0]), and int** would require an array of pointers.",
   "source": "lecture",
   "id": "L02-m4"
  },
  {
   "q": "What is the main historical reason arrays decay to pointers when passed to functions?",
   "options": [
    "To pass an array cheaply as one address instead of copying all its elements, and to unify indexing with pointer arithmetic",
    "So that the callee can know the length of the array",
    "To store arrays on the heap",
    "Because C arrays are implemented as linked lists"
   ],
   "answer": 0,
   "explanation": "From B and early C: passing the address is cheap, and a[i] == *(a+i) maps onto base+index addressing. The price is losing the length.",
   "distractors": "Decay LOSES the length. Arrays stay where they are (stack or static) and are contiguous.",
   "source": "lecture",
   "id": "L02-m5"
  },
  {
   "q": "Which signature lets the function know the array length at compile time without passing it?",
   "options": [
    "void f(int a[])",
    "void f(int* a)",
    "template <size_t N> void f(int (&a)[N])",
    "void f(int a[N])"
   ],
   "answer": 2,
   "explanation": "A reference to an array does not decay, so N is deduced from the argument type.",
   "distractors": "The first two are both int* parameters. `int a[N]` without a template has no N in scope (and would decay anyway).",
   "source": "lecture",
   "id": "L02-m6"
  },
  {
   "q": "In class, `struct Child { int id; int arr[4]; };`. Why does this fail to compile?\n\n    void swap(Child* a, Child* b) { int* temp = a->arr; a->arr = b->arr; b->arr = temp; }",
   "options": [
    "a->arr is a const member",
    "Arrays are not assignable: arr is storage inside the object, not a pointer that can be re-pointed",
    "The -> operator cannot be used on structs",
    "int* cannot hold the address of an array element"
   ],
   "answer": 1,
   "explanation": "`int* temp = a->arr` compiles via decay, but `a->arr = …` tries to assign to an array, which is ill-formed. Swap the elements (a loop, std::swap(a->arr, b->arr)) or use std::array.",
   "distractors": "arr is not const, -> works on any class type, and an int* can point to arr[0].",
   "source": "lecture",
   "id": "L02-m7"
  },
  {
   "q": "With the class fix_pointers code, what are a's values after `swap(&a, &b)`?\n\n    Child a{1, {1,2,3,4}};\n    Child b{2, {1,1,1,0}};\n    swap(&a, &b);   // swaps only arr, element by element",
   "options": [
    "id 2, arr 1 1 1 0",
    "id 1, arr 1 2 3 4",
    "id 2, arr 1 2 3 4",
    "id 1, arr 1 1 1 0"
   ],
   "answer": 3,
   "explanation": "Only the arr members are exchanged through the pointers, so a keeps id 1 and gets b's array.",
   "distractors": "The ids were never touched, and the swap does take effect because it writes through pointers.",
   "source": "lecture",
   "id": "L02-m8"
  },
  {
   "q": "Under the System V x86-64 ABI, where are the arguments of `add(12, 13)` passed and where is the result returned?",
   "options": [
    "On the stack; result on the stack",
    "edi and esi; result in eax",
    "eax and ebx; result in ecx",
    "xmm0 and xmm1; result in xmm0"
   ],
   "answer": 1,
   "explanation": "Integer arguments go in rdi, rsi, rdx, rcx, r8, r9 (32-bit halves for int), and the return goes in rax/eax.",
   "distractors": "The stack is used only after six integer arguments. xmm registers are for floating point.",
   "source": "lecture",
   "id": "L02-m9"
  },
  {
   "q": "What does this print?\n\n    int x = 1, y = 2;\n    int& r = x;\n    r = y;\n    r = 3;\n    std::cout << x << y;",
   "options": [
    "32",
    "13",
    "23",
    "12"
   ],
   "answer": 0,
   "explanation": "References cannot be reseated: `r = y` assigns 2 to x, and `r = 3` then sets x to 3. y stays 2, so it prints 32.",
   "distractors": "13 assumes `r = y` rebinds r to y, which a reference can never do.",
   "source": "lecture",
   "id": "L02-m10"
  },
  {
   "q": "Which statement about C++ references is FALSE?",
   "options": [
    "A reference must be initialised when declared",
    "A const reference can bind to a temporary",
    "A reference can be made to refer to a different object later",
    "A reference parameter typically compiles to the same code as a pointer parameter"
   ],
   "answer": 2,
   "explanation": "References cannot be reseated: assignment through a reference assigns to the referred-to object.",
   "distractors": "The other three are true properties, the last being the 'syntax sugar for pointers' point.",
   "source": "lecture",
   "id": "L02-m11"
  },
  {
   "q": "What does this function do?\n\n    const std::string& name() { std::string s = \"BTC\"; return s; }",
   "options": [
    "Returns a dangling reference: s is destroyed when the function returns, so using the result is UB",
    "Returns a copy of s safely",
    "It is a compile error",
    "Extends the lifetime of s because the return type is const&"
   ],
   "answer": 0,
   "explanation": "Lifetime extension applies only when a temporary is bound directly to a local const reference, not when you return a reference to a local.",
   "distractors": "The function compiles (with a warning). Returning by value would be the safe version.",
   "source": "lecture",
   "id": "L02-m12"
  },
  {
   "q": "In the class byte-building example, `bytes[0..3]` hold `E8 03 00 00` and are read as an int that prints 1000. Which property of x86 makes this work?",
   "options": [
    "Big-endian byte order",
    "Strict aliasing",
    "The vtable layout",
    "Little-endian byte order: the least significant byte is at the lowest address"
   ],
   "answer": 3,
   "explanation": "1000 = 0x000003E8. Little-endian stores E8 first, so the 4 bytes read back as 1000.",
   "distractors": "A big-endian CPU would read 0xE8030000. Strict aliasing is the rule the cast breaks, not what makes it work.",
   "source": "lecture",
   "id": "L02-m13"
  },
  {
   "q": "What is the well-defined way to read 8 raw bytes from a packet buffer `const char* buf` into `struct Coord { int x; int y; }`?",
   "options": [
    "Coord c = *(Coord*)buf;",
    "Coord c; std::memcpy(&c, buf, sizeof c);",
    "Coord& c = reinterpret_cast<Coord&>(buf);",
    "Coord c = static_cast<Coord>(*buf);"
   ],
   "answer": 1,
   "explanation": "memcpy (or C++20 std::bit_cast) copies the bytes into a real Coord object without violating strict aliasing or alignment. At -O2 it becomes a single 8-byte load.",
   "distractors": "The casts read through the wrong type (UB and possibly misaligned), and static_cast<Coord>(char) does not compile.",
   "source": "lecture",
   "id": "L02-m14"
  },
  {
   "q": "What does this print?\n\n    struct B { virtual const char* n() const { return \"B\"; } };\n    struct D : B { const char* n() const override { return \"D\"; } };\n    void byVal(B b) { std::cout << b.n(); }\n    void byRef(const B& b) { std::cout << b.n(); }\n    int main() { D d; byVal(d); byRef(d); }",
   "options": [
    "DD",
    "BB",
    "DB",
    "BD"
   ],
   "answer": 3,
   "explanation": "byVal copies only the B part (slicing), so it calls B::n. byRef refers to the full D object, so dispatch is dynamic and calls D::n.",
   "distractors": "Virtual dispatch requires a pointer or reference to the actual object, and a by-value parameter is a new B.",
   "source": "lecture",
   "id": "L02-m15"
  },
  {
   "q": "What is `sizeof(S)` on x86-64?\n\n    struct S { virtual void f(); int x; };",
   "options": [
    "4",
    "8",
    "16",
    "12"
   ],
   "answer": 2,
   "explanation": "The hidden vptr takes 8 bytes, x takes 4, and the struct is padded to a multiple of its 8-byte alignment, giving 16.",
   "distractors": "12 forgets the trailing padding. 4 or 8 forgets the vptr or the int.",
   "source": "lecture",
   "id": "L02-m16"
  },
  {
   "q": "Why is a virtual call in a hot loop typically slower than a non-virtual one?",
   "options": [
    "It always causes a system call",
    "It requires an indirect call through the vtable that usually cannot be inlined, and the indirect branch may be mispredicted",
    "It allocates memory on each call",
    "Virtual functions are interpreted at run time"
   ],
   "answer": 1,
   "explanation": "The call loads vptr and the slot, then jumps indirectly. Losing inlining blocks constant folding and vectorisation, and a mispredict costs about 15–20 cycles.",
   "distractors": "There are no syscalls, allocations or interpretation involved.",
   "source": "lecture",
   "id": "L02-m17"
  },
  {
   "q": "`Base* p = new Derived; delete p;` where Base has a non-virtual destructor. What is the result?",
   "options": [
    "Undefined behaviour (in practice Derived's destructor does not run)",
    "Both destructors run correctly",
    "A compile error",
    "Only Derived's destructor runs"
   ],
   "answer": 0,
   "explanation": "Deleting through a base pointer without a virtual destructor is UB. Typically only ~Base runs, which leaks Derived's resources.",
   "distractors": "It compiles silently (maybe with -Wdelete-non-virtual-dtor). The virtual destructor is what makes both run.",
   "source": "lecture",
   "id": "L02-m18"
  },
  {
   "q": "In class, what does this program print?\n\n    struct Person { int id; Person(int i):id(i){} ~Person(){ std::cout << id << \" Person delete\\n\"; } };\n    void f() { Person* p = new Person(1); }\n    int main() { f(); }",
   "options": [
    "1 Person delete",
    "Nothing: the heap object is never deleted, so its destructor never runs (a leak)",
    "It crashes at exit",
    "1 Person delete, printed twice"
   ],
   "answer": 1,
   "explanation": "Only the pointer p (a local) is destroyed at the end of f. The heap Person lives on, and there is no GC to run its destructor.",
   "distractors": "A stack object `Person p{1};` would print the message. Leaks don't crash, and the OS reclaims the memory at exit.",
   "source": "lecture",
   "id": "L02-m19"
  },
  {
   "q": "Which is true about `std::unique_ptr<Order>` with the default deleter?",
   "options": [
    "It holds a reference count, so it is 16 bytes",
    "It can be copied but not moved",
    "It is the size of a raw pointer and move-only; it deletes the Order in its destructor",
    "It is garbage-collected"
   ],
   "answer": 2,
   "explanation": "unique_ptr is a raw pointer with an RAII destructor and deleted copy operations. It has zero overhead.",
   "distractors": "Reference counting is shared_ptr. Copy is the deleted operation, not move.",
   "source": "lecture",
   "id": "L02-m20"
  },
  {
   "q": "What happens here?\n\n    auto p = std::make_unique<int>(5);\n    int* raw = p.release();",
   "options": [
    "The int is deleted and raw is dangling",
    "Compile error",
    "p still owns the int and raw is a copy of it",
    "p becomes null, and the caller now owns the int through raw and must delete it"
   ],
   "answer": 3,
   "explanation": "release() gives up ownership without freeing anything. Forgetting `delete raw` leaks the int.",
   "distractors": "reset() is the call that deletes. release() is legal and returns the pointer.",
   "source": "lecture",
   "id": "L02-m21"
  },
  {
   "q": "In class `Lec-6/heap_memory.cpp`: `int* arr = new int[1024*2024]; delete arr;`. What is correct?",
   "options": [
    "It is fine because int is trivially destructible",
    "It is UB: memory from new[] must be released with delete[]",
    "It is a compile error",
    "It deletes only the first element"
   ],
   "answer": 1,
   "explanation": "The forms must match: new with delete, new[] with delete[], malloc with free. It may appear to work for int on glibc, but the standard says UB.",
   "distractors": "There is no 'first element only' rule, and the compiler accepts it.",
   "source": "lecture",
   "id": "L02-m22"
  },
  {
   "q": "Which bug does this contain?\n\n    int* p = new int(7);\n    delete p;\n    std::cout << *p;",
   "options": [
    "Memory leak",
    "Double free",
    "Use-after-free (dangling pointer dereference)",
    "Buffer overflow"
   ],
   "answer": 2,
   "explanation": "p still holds the old address after delete, and reading through it is UB.",
   "distractors": "It is freed exactly once, so there is no leak or double free.",
   "source": "lecture",
   "id": "L02-m23"
  }
 ],
 "msqs": [
  {
   "q": "Which are legitimate reasons C needs pointers? (select all that apply)",
   "options": [
    "To let a function modify the caller's variables",
    "To avoid copying large objects when calling a function",
    "To make integer arithmetic faster",
    "To build linked data structures and use dynamic memory",
    "To access memory-mapped hardware or shared buffers"
   ],
   "answers": [
    0,
    1,
    3,
    4
   ],
   "explanation": "Pointers enable out-parameters, cheap passing, heap allocation and linked structures, and direct addressing of hardware or shared memory. They do nothing for integer arithmetic speed.",
   "id": "L02-x1"
  },
  {
   "q": "In which of these does `int a[8]` decay to `int*`? (select all that apply)",
   "options": [
    "int* p = a;",
    "sizeof(a)",
    "a[3] (i.e. *(a+3))",
    "auto& r = a;",
    "std::cout << a;"
   ],
   "answers": [
    0,
    2,
    4
   ],
   "explanation": "Initialising a pointer, indexing and streaming (which prints the address) all decay. sizeof(a) is 32, and binding a reference gives int(&)[8], so neither decays.",
   "id": "L02-x2"
  },
  {
   "q": "Which statements about references are true? (select all that apply)",
   "options": [
    "They must be initialised",
    "They can be null",
    "Assignment through a reference changes the referred object, never the binding",
    "They are commonly implemented as a pointer by the compiler",
    "sizeof(int&) is 8 on x86-64"
   ],
   "answers": [
    0,
    2,
    3
   ],
   "explanation": "References must be bound once, can't be null or reseated, and compile like a const pointer. sizeof of a reference type is the size of the referred type (4 for int).",
   "id": "L02-x3"
  },
  {
   "q": "Which correctly swap the `arr` members of two `Child` objects (`int arr[4]`) given `Child* a, Child* b`? (select all that apply)",
   "options": [
    "for (int i = 0; i < 4; ++i) std::swap(a->arr[i], b->arr[i]);",
    "std::swap(a->arr, b->arr);",
    "int* t = a->arr; a->arr = b->arr; b->arr = t;",
    "int t[4]; std::memcpy(t, a->arr, 16); std::memcpy(a->arr, b->arr, 16); std::memcpy(b->arr, t, 16);",
    "std::swap(a, b);"
   ],
   "answers": [
    0,
    1,
    3
   ],
   "explanation": "Element-wise swap, std::swap's array overload and memcpy all move the bytes. Assigning arrays does not compile, and std::swap(a, b) only swaps the local pointer variables, leaving both objects unchanged.",
   "id": "L02-x4"
  },
  {
   "q": "Which of the following are good parameter choices for performance? (select all that apply)",
   "options": [
    "void f(double px)",
    "void f(const std::vector<Order>& v)",
    "void f(std::string s) for a read-only 1 KB string",
    "void f(const int& x) for a plain int",
    "void f(Order& o) when f must modify o"
   ],
   "answers": [
    0,
    1,
    4
   ],
   "explanation": "Small scalars go by value (in a register), large containers by const&, and in-out parameters by reference. Copying a 1 KB string just to read it is wasteful, and const int& forces the int into memory for no benefit.",
   "id": "L02-x5"
  },
  {
   "q": "Which statements about the class `Cordinate` cast `Cordinate* c = (Cordinate*)bytes;` (where bytes is int8_t[8]) are true? (select all that apply)",
   "options": [
    "It prints 1000 and 2000 on x86 because x86 is little-endian",
    "It is well-defined C++",
    "It violates strict aliasing, so it is formally UB",
    "bytes may not be suitably aligned for int",
    "std::memcpy into a Cordinate is the correct alternative"
   ],
   "answers": [
    0,
    2,
    3,
    4
   ],
   "explanation": "The demo works on x86 due to little-endian layout, but reading int8_t storage through a Cordinate* is UB (strict aliasing) and alignment isn't guaranteed. memcpy or std::bit_cast is the defined way.",
   "id": "L02-x6"
  },
  {
   "q": "Which of the following cause a virtual call to resolve to the derived override? (select all that apply)",
   "options": [
    "Calling through Base& bound to a Derived",
    "Calling through Base* pointing to a Derived",
    "Calling on a Base parameter passed by value from a Derived",
    "Calling a virtual function from inside Base's constructor while constructing a Derived",
    "Calling through std::unique_ptr<Base> holding a Derived"
   ],
   "answers": [
    0,
    1,
    4
   ],
   "explanation": "Dynamic dispatch needs a pointer or reference to the real object. A by-value Base is sliced, and inside Base's constructor the object is still only a Base.",
   "id": "L02-x7"
  },
  {
   "q": "Which are costs of a virtual function call compared with a direct call? (select all that apply)",
   "options": [
    "Loading the vptr and then the vtable slot",
    "An indirect branch that may be mispredicted",
    "It usually prevents inlining",
    "A heap allocation per call",
    "A mutex lock per call"
   ],
   "answers": [
    0,
    1,
    2
   ],
   "explanation": "Dispatch costs two loads plus an indirect jump, and the lost inlining is often the biggest cost. There is no allocation or locking.",
   "id": "L02-x8"
  },
  {
   "q": "Which statements about `std::unique_ptr` are true? (select all that apply)",
   "options": [
    "It is move-only",
    "With the default deleter it stores a deleter function pointer next to the object pointer (16 bytes)",
    "It uses an atomic reference count",
    "unique_ptr<T[]> calls delete[]",
    "release() frees the object"
   ],
   "answers": [
    0,
    3
   ],
   "explanation": "unique_ptr is sole-ownership and move-only, and the array specialisation uses delete[]. With the default (empty) deleter it is just 8 bytes, the size of a raw pointer. Reference counting is shared_ptr, and release() hands back the pointer without freeing it.",
   "id": "L02-x9"
  },
  {
   "q": "Which of these are memory leaks? (select all that apply)",
   "options": [
    "void f(){ Person* p = new Person(1); }",
    "void f(){ Person p{1}; }",
    "void f(){ auto p = std::make_unique<Person>(1); }",
    "void f(){ int* a = new int[10]; a = new int[20]; delete[] a; }",
    "void f(){ std::vector<int> v(1000); }"
   ],
   "answers": [
    0,
    3
   ],
   "explanation": "The first never deletes, and the fourth loses the first array when a is overwritten. Stack objects, unique_ptr and vector all release their memory automatically (RAII).",
   "id": "L02-x10"
  },
  {
   "q": "Which of these have undefined behaviour? (select all that apply)",
   "options": [
    "int* p = new int[4]; delete p;",
    "int* p = new int; delete p; delete p;",
    "int* p = nullptr; delete p;",
    "int& r() { int x = 1; return x; }  then using r()",
    "std::unique_ptr<int> u; u.reset();"
   ],
   "answers": [
    0,
    1,
    3
   ],
   "explanation": "Mismatched delete, double free and using a dangling reference are UB. Deleting a nullptr is a defined no-op, and resetting an empty unique_ptr is fine.",
   "id": "L02-x11"
  },
  {
   "q": "Which tools or practices help catch memory-safety bugs? (select all that apply)",
   "options": [
    "Compiling with -fsanitize=address",
    "Running under valgrind --leak-check=full",
    "Compiling with -O3 only",
    "Using std::vector and unique_ptr instead of raw new/delete",
    "Casting all pointers to void*"
   ],
   "answers": [
    0,
    1,
    3
   ],
   "explanation": "ASan and valgrind detect leaks, overflows and use-after-free at run time, and RAII types prevent the bugs. -O3 can expose UB but doesn't detect it, and void* removes type safety.",
   "id": "L02-x12"
  },
  {
   "q": "Given `const int* p` and `int* const q` (both pointing to valid ints), which statements compile? (select all that apply)",
   "options": [
    "*p = 5;",
    "p = nullptr;",
    "*q = 5;",
    "q = nullptr;",
    "int v = *p;"
   ],
   "answers": [
    1,
    2,
    4
   ],
   "explanation": "p is a pointer to const: it can be reseated but not written through. q is a const pointer: it can be written through but not reseated. Reading through either is fine.",
   "id": "L02-x13"
  }
 ],
 "short": [
  {
   "q": "Explain array decay: what it is, where it does not happen, why C was designed this way, and how modern C++ avoids its downside.",
   "checks": [
    {
     "label": "Defines decay as conversion to pointer to first element",
     "patterns": [
      "pointer to (the |its )?first element|&a\\[0\\]|&arr\\[0\\]"
     ]
    },
    {
     "label": "Lists at least sizeof as an exception",
     "patterns": [
      "sizeof"
     ]
    },
    {
     "label": "Gives the cheap-passing / no-copy reason",
     "patterns": [
      "cheap|copy|copying|one address|single address"
     ]
    },
    {
     "label": "Mentions loss of size / length",
     "patterns": [
      "los(e|es|t|ing) (the )?(size|length)|length is lost|size is lost|doesn.t know the (size|length)"
     ]
    },
    {
     "label": "Mentions span / std::array / template reference",
     "patterns": [
      "span|std::array|\\(&\\w*\\)\\[N\\]"
     ]
    }
   ],
   "modelAnswer": "**What it is:** in most expressions an array of `T` is implicitly converted to a pointer to its first element (`a` becomes `&a[0]`, type `T*`), so `a[i]` means `*(a+i)` and a function parameter `int a[10]` is really `int*`.\n\n**Exceptions:** `sizeof(a)` (it gives the full array size), `&a` (pointer to the whole array, `int(*)[N]`), `decltype(a)`, binding to a reference `int (&r)[N]`, and a string literal initialising a char array.\n\n**Why:** from C's predecessor B. Passing an array as one address is cheap (no copying of all elements on every call), and it unifies indexing with pointer arithmetic, matching the hardware's `base + index*scale` addressing.\n\n**Downside:** the callee loses the size and length (`sizeof` gives 8), which leads to buffer overflows.\n\n**Modern fixes:** pass `std::span<T>` (pointer + length, C++20), use `std::array<T,N>` (never decays), or a template reference to the array `template<size_t N> void f(int (&a)[N])`, or pass the length explicitly.",
   "explanation": "The examiner wants the definition, the exceptions, the historical reason and the cost with its modern fix.",
   "id": "L02-s1"
  },
  {
   "q": "Compare pass-by-value, pass-by-pointer and pass-by-reference in C++. When would you use each in performance-sensitive code?",
   "checks": [
    {
     "label": "By value makes a copy / caller unchanged",
     "patterns": [
      "cop(y|ies)"
     ]
    },
    {
     "label": "Pointer can be null / explicit address",
     "patterns": [
      "null"
     ]
    },
    {
     "label": "Reference is an alias / cannot be null / reseated",
     "patterns": [
      "alias|cannot be (null|reseat)|can.t be (null|reseat)"
     ]
    },
    {
     "label": "Small types by value (registers)",
     "patterns": [
      "register|small"
     ]
    },
    {
     "label": "Large types by const reference",
     "patterns": [
      "const ?&|const reference|const T&"
     ]
    }
   ],
   "modelAnswer": "- **By value**: the callee gets a copy, and changes don't affect the caller. It is cheapest for small, trivially copyable types (`int`, `double`, a 16-byte price/qty struct) because they travel in registers and the compiler knows nothing aliases them.\n- **By pointer**: the address is copied (8 bytes) and the callee can modify the caller's object through `*p`. It can be null, so it is used for optional parameters and C APIs, and the call site shows `&x` explicitly.\n- **By reference**: an alias for the caller's object, with no copy. It cannot be null or reseated, and it is usually compiled exactly like a pointer. Use `T&` for in-out parameters and `const T&` for large read-only objects (`std::string`, `std::vector`, big structs) to avoid an expensive copy.\n\nRule of thumb: small types by value, large types by `const&`, modification by `&`, and \"may be absent\" by pointer (or `std::optional`).",
   "explanation": "The point is the semantics (copy, nullability, aliasing) plus the cost-based rule for choosing.",
   "id": "L02-s2"
  },
  {
   "q": "In class we tried to swap the `arr` members of two `Child` structs (`struct Child { int id; int arr[4]; };`) by swapping pointers:\n\n    void swap(Child* a, Child* b) { int* temp = (*a).arr; (*a).arr = (*b).arr; (*b).arr = temp; }\n\nWhy doesn't this work, and write a correct version.",
   "checks": [
    {
     "label": "Says arrays are not assignable / compile error",
     "patterns": [
      "not assignable|cannot (be )?assign|can.t (be )?assign|compile error|does not compile|doesn.t compile"
     ]
    },
    {
     "label": "Explains arr is storage inside the object, not a pointer",
     "patterns": [
      "not a pointer|storage|inside the (object|struct)"
     ]
    },
    {
     "label": "Mentions decay for the first line",
     "patterns": [
      "deca"
     ]
    },
    {
     "label": "Gives an element-wise / std::swap / memcpy fix",
     "patterns": [
      "std::swap|for\\s*\\(|memcpy|std::array"
     ]
    }
   ],
   "modelAnswer": "`int* temp = (*a).arr;` compiles only because the array member **decays** to a pointer to its first element. But `(*a).arr = (*b).arr;` is a **compile error**: arrays are not assignable. `arr` is 16 bytes of storage *inside* the `Child` object, not a pointer variable that could be re-pointed. To swap, the bytes themselves must move:\n\n```cpp\nvoid swap(Child* a, Child* b) {\n    for (size_t i = 0; i < 4; ++i) {\n        int t = a->arr[i];\n        a->arr[i] = b->arr[i];\n        b->arr[i] = t;\n    }\n    // or simply: std::swap(a->arr, b->arr);   (array overload)\n    // or: declare std::array<int,4> arr; then a->arr.swap(b->arr);\n}\n```",
   "explanation": "This tests that an array member is storage, not a pointer, which is the subtle point the class code demonstrated.",
   "id": "L02-s3"
  },
  {
   "q": "Explain how a virtual function call works (vptr and vtable), what it costs compared with a normal call, and why a polymorphic base class needs a virtual destructor.",
   "checks": [
    {
     "label": "Mentions vptr in each object",
     "patterns": [
      "vptr|virtual (table )?pointer"
     ]
    },
    {
     "label": "Mentions vtable of function pointers",
     "patterns": [
      "vtable|v-table|virtual table"
     ]
    },
    {
     "label": "Indirect call / branch misprediction",
     "patterns": [
      "indirect|mispredict"
     ]
    },
    {
     "label": "Prevents inlining",
     "patterns": [
      "inlin"
     ]
    },
    {
     "label": "Virtual destructor: delete via base pointer otherwise UB / derived dtor not run",
     "patterns": [
      "undefined|\\bub\\b|derived (class )?destructor|~Derived"
     ]
    }
   ],
   "modelAnswer": "Each object of a class with virtual functions holds a hidden **vptr** (8 bytes, usually at offset 0) that points to the class's **vtable**, a static array of function pointers, one per virtual function. `p->f()` compiles to: load the vptr from `*p`, load the slot for `f` from the vtable, then make an **indirect call** through that address.\n\nCost compared with a direct call: two dependent loads (usually cache hits), and an indirect branch that the predictor may miss (about 15–20 cycles if mispredicted). Most importantly, the compiler usually **cannot inline** the call, so constant folding and vectorisation across it are lost. This is why HFT hot paths use templates or CRTP instead.\n\n**Virtual destructor:** if `Base* p = new Derived; delete p;` and `~Base` is not virtual, the behaviour is **undefined**. In practice only `~Base` runs, so `~Derived` never releases its members (leaks, half-destroyed objects). Declaring `virtual ~Base() = default;` makes `delete` dispatch to `~Derived` first and then `~Base`.",
   "explanation": "The examiner wants the mechanism, the latency cost (especially lost inlining) and the virtual destructor rule.",
   "id": "L02-s4"
  },
  {
   "q": "C++ has no garbage collector. Explain what a memory leak is using the class Person example (new Person in a function), why it matters in a trading system, and show how unique_ptr fixes it.",
   "checks": [
    {
     "label": "Defines leak as unreachable / never freed memory",
     "patterns": [
      "never (freed|deleted|released)|unreachable|no longer reachable|not freed"
     ]
    },
    {
     "label": "Notes the destructor never runs",
     "patterns": [
      "destructor (never|is never|does not|doesn.t) run|never prints|nothing is printed|no output"
     ]
    },
    {
     "label": "Long-running process grows memory",
     "patterns": [
      "long[- ]running|grows|out of memory|\\boom\\b|all day"
     ]
    },
    {
     "label": "Uses make_unique / unique_ptr",
     "patterns": [
      "make_unique|unique_ptr"
     ]
    },
    {
     "label": "Mentions RAII / automatic deletion at scope exit",
     "patterns": [
      "raii|scope|automatic"
     ]
    }
   ],
   "modelAnswer": "```cpp\nvoid f() { Person* p = new Person(1, 12, 0); }   // class example\n```\n\nWhen `f` returns, only the local pointer `p` is destroyed. The `Person` on the heap is **never freed** and is now **unreachable**. That is a memory leak, and it is why the destructor never runs: \"Person delete\" is never printed and there is no output. There is no GC to clean it up. The OS reclaims the memory only when the process exits.\n\nIn a trading engine that runs all day and handles millions of orders, a leak on a per-order path makes resident memory grow continuously. That means more page faults and cache pollution, and eventually the process runs out of memory (OOM) mid-session.\n\nFix with RAII:\n\n```cpp\nvoid f() { auto p = std::make_unique<Person>(1, 12, 0); }\n// prints \"1 Person delete\" at scope exit: unique_ptr's destructor calls delete\n```\n\nEven better, if the object doesn't need to outlive the function, put it on the stack: `Person p{1, 12, 0};`. `unique_ptr` has zero overhead (it is the size of a raw pointer), and ownership is explicit and move-only.",
   "explanation": "The examiner expects the definition, the consequence for a long-running process, and the RAII fix.",
   "id": "L02-s5"
  },
  {
   "q": "Find all the memory-safety bugs:\n\n    int* make() { int local[4] = {1,2,3,4}; return local; }\n    int main() {\n        int* a = new int[8];\n        int* b = a;\n        delete a;\n        delete[] b;\n        int* c = make();\n        std::cout << c[0];\n    }",
   "checks": [
    {
     "label": "delete instead of delete[] for new[]",
     "patterns": [
      "delete\\[\\]|mismatch"
     ]
    },
    {
     "label": "Double free (a and b alias)",
     "patterns": [
      "double[- ]free|freed twice|deleted twice"
     ]
    },
    {
     "label": "Returning address of local / dangling",
     "patterns": [
      "dangling|local|stack (frame|memory)"
     ]
    },
    {
     "label": "Calls it UB",
     "patterns": [
      "undefined|\\bub\\b"
     ]
    }
   ],
   "modelAnswer": "1. `delete a;` on memory from `new int[8]` is a **mismatched** deallocation (it must be `delete[] a`). That is UB.\n2. `b` aliases the same block, so `delete[] b;` frees it a second time: a **double free** (UB, and glibc typically aborts with \"double free detected\").\n3. `make()` returns the address of the **local** array `local`, whose stack frame is gone after the return. `c` is a **dangling** pointer, and reading `c[0]` is UB (garbage or a crash).\n\nFixed version:\n\n```cpp\nstd::array<int,4> make() { return {1,2,3,4}; }   // return by value\nint main() {\n    std::vector<int> a(8);            // or auto a = std::make_unique<int[]>(8);\n    auto c = make();\n    std::cout << c[0];\n}\n```",
   "explanation": "One mark per bug (mismatched delete, double free, dangling stack pointer) plus calling them UB.",
   "id": "L02-s6"
  }
 ],
 "quiz": [],
 "coding": [
  {
   "id": "unique-ptr",
   "title": "UniquePtr with a Custom Deleter"
  }
 ],
 "prev": {
  "num": 1,
  "file": "lecture-01.html"
 },
 "next": {
  "num": 3,
  "file": "lecture-03.html"
 }
};
