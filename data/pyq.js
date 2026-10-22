window.PAGE = {
 "title": "Previous year paper: End Term (2027 batch)",
 "format": "30 questions in 150 minutes: Section 1 has 25 MCQs (some select-all), Section 2 has 4 coding questions (attempt any 2), Section 3 has 1 diagram question.",
 "mcqs": [
  {
   "type": "mcq",
   "n": 1,
   "q": "What will `sizeof(struct E)` be on a 64-bit system?\n```cpp\nstruct E {\n    int a;\n    double b;\n    char c;\n};\n```\n",
   "options": [
    "13",
    "16",
    "24",
    "32"
   ],
   "answer": 2,
   "session": 8,
   "explanation": "`a` takes bytes 0–3, then 4 bytes of padding so the `double` starts at an 8-byte boundary (bytes 8–15), then `c` at byte 16. The struct's alignment is 8 (its largest member), so the size is rounded up from 17 to **24**.",
   "id": "PYQ-1",
   "ref": "<a href=\"../lectures/lecture-08.html\">Session 8: Computer Architecture for HFT</a>"
  },
  {
   "type": "mcq",
   "n": 2,
   "q": "What will `sizeof(struct A)` be on a 64-bit system?\n```cpp\nstruct A {\n    char c1;\n    double d;\n    char c2;\n    int i;\n};\n```\n",
   "options": [
    "16",
    "24",
    "32",
    "40"
   ],
   "answer": 1,
   "session": 8,
   "explanation": "`c1` at 0, 7 bytes of padding, `d` at 8–15, `c2` at 16, 3 bytes of padding, `i` at 20–23. That's 24 bytes, already a multiple of the struct's 8-byte alignment, so **24**. (Reordering as d, i, c1, c2 would give 16.)",
   "id": "PYQ-2",
   "ref": "<a href=\"../lectures/lecture-08.html\">Session 8: Computer Architecture for HFT</a>"
  },
  {
   "type": "mcq",
   "n": 3,
   "q": "If a structure's largest member is 8 bytes, its alignment requirement will be:",
   "options": [
    "2 bytes",
    "4 bytes",
    "8 bytes",
    "Depends on total structure size"
   ],
   "answer": 2,
   "session": 8,
   "explanation": "A struct's alignment is the largest alignment of its members, so **8 bytes**. Its *size* depends on the layout; its *alignment* doesn't.",
   "id": "PYQ-3",
   "ref": "<a href=\"../lectures/lecture-08.html\">Session 8: Computer Architecture for HFT</a>"
  },
  {
   "type": "mcq",
   "n": 4,
   "q": "You have a multi-threaded C++ program where two threads frequently update separate members of a class:\n```cpp\n#include <atomic>\nclass Queue {\npublic:\n    std::atomic<size_t> head;\n    std::atomic<size_t> tail;\n};\n```\n\nThread A updates `head`, Thread B updates `tail`. Assume a 64-byte cache line and that `head` and `tail` are 8 bytes each. What issue may occur during concurrent updates?",
   "options": [
    "Cache thrashing due to shared L3 cache",
    "False sharing between head and tail",
    "Memory leak due to atomic operations",
    "Deadlock between threads"
   ],
   "answer": 1,
   "session": 10,
   "explanation": "`head` and `tail` sit in the same 64-byte line. Each write by one core invalidates that line in the other core's cache (MESI), so they ping-pong even though the threads touch different variables. That is **false sharing**. Atomics don't leak or deadlock.",
   "id": "PYQ-4",
   "ref": "<a href=\"../lectures/lecture-10.html\">Session 10: Atomics and Concurrency 2</a>"
  },
  {
   "type": "msq",
   "n": 5,
   "q": "Two threads frequently update different atomic members of the same object (`head` and `tail`), and performance degrades because they share a cache line. Which class definitions correctly mitigate this? (select all that apply)\n```cpp\nA. class alignas(64) Queue { public: std::atomic<size_t> head; std::atomic<size_t> tail; };\nB. class Queue { public: alignas(64) std::atomic<size_t> head; alignas(64) std::atomic<size_t> tail; };\nC. class Queue { public: std::atomic<size_t> head; char padding[64]; std::atomic<size_t> tail; };\nD. class Queue { public: std::atomic<size_t> head; std::atomic<size_t> tail; } alignas(64);\n```\n",
   "options": [
    "A",
    "B",
    "C",
    "D"
   ],
   "answers": [
    1,
    2
   ],
   "session": 10,
   "explanation": "**B** gives each member its own 64-byte line. **C** puts 64 bytes of padding between them, so they're 72 bytes apart and can never share a line. **A** only aligns the *start* of the object, so head and tail are still adjacent in one line. **D** isn't valid syntax for aligning a class.",
   "id": "PYQ-5",
   "ref": "<a href=\"../lectures/lecture-10.html\">Session 10: Atomics and Concurrency 2</a>"
  },
  {
   "type": "mcq",
   "n": 6,
   "q": "When a virtual address is accessed, which sequence is correct in terms of lookup order?",
   "options": [
    "TLB -> Page Table -> Cache -> Main Memory",
    "Cache -> TLB -> Page Table -> Main Memory",
    "Page Table -> TLB -> Cache -> Main Memory",
    "Cache -> Page Table -> TLB -> Main Memory"
   ],
   "answer": 0,
   "session": 8,
   "explanation": "The address must first be translated: check the **TLB**, and on a miss walk the **page table**. The physical address is then looked up in the **cache** (L1 → L2 → L3), and only on a miss does it go to **main memory**.",
   "id": "PYQ-6",
   "ref": "<a href=\"../lectures/lecture-08.html\">Session 8: Computer Architecture for HFT</a>"
  },
  {
   "type": "mcq",
   "n": 7,
   "q": "If a CPU has an L1 cache of 32 KB and a cache line size of 64 bytes, how many cache lines can L1 hold?",
   "options": [
    "512",
    "1024",
    "2048",
    "4096"
   ],
   "answer": 0,
   "session": 8,
   "explanation": "32 KB = 32 × 1024 = 32,768 bytes, and 32,768 / 64 = **512** lines.",
   "id": "PYQ-7",
   "ref": "<a href=\"../lectures/lecture-08.html\">Session 8: Computer Architecture for HFT</a>"
  },
  {
   "type": "mcq",
   "n": 8,
   "q": "The TLB (Translation Lookaside Buffer) stores:",
   "options": [
    "Recently used cache lines",
    "Virtual-to-physical page translations",
    "Instruction prefetch queue",
    "Disk I/O buffer entries"
   ],
   "answer": 1,
   "session": 8,
   "explanation": "The TLB is a small cache of **page-table entries** (virtual page → physical frame), so most accesses skip the slow page-table walk.",
   "id": "PYQ-8",
   "ref": "<a href=\"../lectures/lecture-08.html\">Session 8: Computer Architecture for HFT</a>"
  },
  {
   "type": "mcq",
   "n": 9,
   "q": "The purpose of cache lines is to:",
   "options": [
    "Map physical pages to virtual memory",
    "Store contiguous bytes fetched from main memory",
    "Reduce page faults",
    "Maintain CPU scheduling order"
   ],
   "answer": 1,
   "session": 8,
   "explanation": "Memory moves between RAM and cache in fixed-size blocks of **contiguous bytes** (64 B on x86). Fetching neighbours too is what makes sequential access (spatial locality) fast.",
   "id": "PYQ-9",
   "ref": "<a href=\"../lectures/lecture-08.html\">Session 8: Computer Architecture for HFT</a>"
  },
  {
   "type": "mcq",
   "n": 10,
   "q": "The difference between a page and a frame is:",
   "options": [
    "Pages are in RAM, frames are on disk",
    "Pages are virtual memory units, frames are physical memory units",
    "Frames are used only by GPU, pages by CPU",
    "Pages are smaller than frames"
   ],
   "answer": 1,
   "session": 8,
   "explanation": "A **page** is a block of a process's *virtual* address space; a **frame** is a same-sized block of *physical* RAM. The page table maps pages to frames.",
   "id": "PYQ-10",
   "ref": "<a href=\"../lectures/lecture-08.html\">Session 8: Computer Architecture for HFT</a>"
  },
  {
   "type": "mcq",
   "n": 11,
   "q": "What is the typical cache line size on modern x86 CPUs?",
   "options": [
    "16 bytes",
    "32 bytes",
    "64 bytes",
    "128 bytes"
   ],
   "answer": 2,
   "session": 8,
   "explanation": "**64 bytes** on Intel and AMD x86. (Apple's M-series uses 128-byte lines, which is a common trap.)",
   "id": "PYQ-11",
   "ref": "<a href=\"../lectures/lecture-08.html\">Session 8: Computer Architecture for HFT</a>"
  },
  {
   "type": "mcq",
   "n": 12,
   "q": "What does the following code print?\n```cpp\nint a = 10;\nint* p = &a;\nstd::cout << *p;\n```\n",
   "options": [
    "Address of a",
    "Value 10",
    "Compilation error",
    "Undefined behavior"
   ],
   "answer": 1,
   "session": 2,
   "explanation": "`p` holds the address of `a`, and `*p` dereferences it, giving the **value 10**. Printing `p` itself would print the address.",
   "id": "PYQ-12",
   "ref": "<a href=\"../lectures/lecture-02.html\">Session 2: Pointers and References</a>"
  },
  {
   "type": "mcq",
   "n": 13,
   "q": "What is the size of a pointer variable on a 64-bit machine?",
   "options": [
    "2 bytes",
    "4 bytes",
    "8 bytes",
    "Depends on data type"
   ],
   "answer": 2,
   "session": 2,
   "explanation": "Every object pointer is **8 bytes** on a 64-bit system, whatever it points to (`int*`, `double*`, `char*`…).",
   "id": "PYQ-13",
   "ref": "<a href=\"../lectures/lecture-02.html\">Session 2: Pointers and References</a>"
  },
  {
   "type": "mcq",
   "n": 14,
   "q": "Identify the problem:\n```cpp\nint* f() {\n    int a = 10;\n    return &a;\n}\n```\n",
   "options": [
    "Works fine",
    "Memory leak",
    "Returning address of local variable",
    "None"
   ],
   "answer": 2,
   "session": 3,
   "explanation": "`a` lives on `f`'s stack frame, which is released when `f` returns. The caller gets a **dangling pointer**, and using it is undefined behaviour. Nothing was heap-allocated, so it isn't a leak.",
   "id": "PYQ-14",
   "ref": "<a href=\"../lectures/lecture-03.html\">Session 3: Pointers and References 2: Stack, Heap and Allocators</a>"
  },
  {
   "type": "mcq",
   "n": 15,
   "q": "What happens here?\n```cpp\n#include <memory>\nint main() {\n    std::unique_ptr<int> p1 = std::make_unique<int>(5);\n    std::unique_ptr<int> p2 = p1;\n}\n```\n",
   "options": [
    "Copies ownership",
    "Undefined behavior",
    "Compile-time error",
    "Works fine"
   ],
   "answer": 2,
   "session": 7,
   "explanation": "`unique_ptr`'s copy constructor is **deleted**, because two owners would mean a double delete. So it's a **compile-time error**. You must write `std::move(p1)`.",
   "id": "PYQ-15",
   "ref": "<a href=\"../lectures/lecture-07.html\">Session 7: Move Semantics 2 + Smart Pointers</a>"
  },
  {
   "type": "mcq",
   "n": 16,
   "q": "How do you correctly transfer ownership of a `std::unique_ptr`?",
   "options": [
    "p2 = p1;",
    "p2 = std::move(p1);",
    "p2.reset(p1);",
    "p2.swap(p1.get());"
   ],
   "answer": 1,
   "session": 7,
   "explanation": "Move assignment transfers ownership and leaves `p1` null. `reset` takes a raw pointer (`p2.reset(p1.release())` would work), and `swap` takes another `unique_ptr`, not a raw pointer.",
   "id": "PYQ-16",
   "ref": "<a href=\"../lectures/lecture-07.html\">Session 7: Move Semantics 2 + Smart Pointers</a>"
  },
  {
   "type": "mcq",
   "n": 17,
   "q": "What is the output here?\n```cpp\nint x = 10;\nint* p = &x;\nint** q = &p;\n**q = 20;\nstd::cout << x;\n```\n",
   "options": [
    "20",
    "10",
    "Garbage",
    "Error"
   ],
   "answer": 0,
   "session": 2,
   "explanation": "`*q` is `p` and `**q` is `x`, so the assignment writes 20 into `x`. It prints **20**.",
   "id": "PYQ-17",
   "ref": "<a href=\"../lectures/lecture-02.html\">Session 2: Pointers and References</a>"
  },
  {
   "type": "mcq",
   "n": 18,
   "q": "What is the output?\n```cpp\nint arr[] = {5, 10, 15, 20};\nint* p = arr + 2;\nstd::cout << p[-1];\n```\n",
   "options": [
    "5",
    "10",
    "20"
   ],
   "answer": 1,
   "session": 2,
   "explanation": "`p` points to `arr[2]` (15), and `p[-1]` is `*(p - 1)`, which is `arr[1]`, so **10**. Negative indexing is fine while you stay inside the array.",
   "id": "PYQ-18",
   "ref": "<a href=\"../lectures/lecture-02.html\">Session 2: Pointers and References</a>"
  },
  {
   "type": "mcq",
   "n": 19,
   "q": "Where are local variables (like `int x = 5;`) stored by default?",
   "options": [
    "Stack",
    "Heap",
    "Global data segment",
    "CPU register"
   ],
   "answer": 0,
   "session": 3,
   "explanation": "Automatic (local) variables live on the **stack**. The optimiser may keep them in a register, but the language-level answer is the stack.",
   "id": "PYQ-19",
   "ref": "<a href=\"../lectures/lecture-03.html\">Session 3: Pointers and References 2: Stack, Heap and Allocators</a>"
  },
  {
   "type": "mcq",
   "n": 20,
   "q": "When is stack memory automatically released?",
   "options": [
    "At program exit",
    "Never",
    "When delete is called",
    "When the function returns"
   ],
   "answer": 3,
   "session": 3,
   "explanation": "A function's stack frame, holding all its locals, is popped **when the function returns** (destructors run at scope exit). No `delete` is needed.",
   "id": "PYQ-20",
   "ref": "<a href=\"../lectures/lecture-03.html\">Session 3: Pointers and References 2: Stack, Heap and Allocators</a>"
  },
  {
   "type": "mcq",
   "n": 21,
   "q": "When is heap memory released?",
   "options": [
    "Automatically at scope end",
    "When free() or delete is called",
    "When function returns",
    "At compile time"
   ],
   "answer": 1,
   "session": 3,
   "explanation": "Heap memory lives until you release it with **`delete`/`free()`**, or until a smart pointer's destructor does it for you. Forgetting is a memory leak.",
   "id": "PYQ-21",
   "ref": "<a href=\"../lectures/lecture-03.html\">Session 3: Pointers and References 2: Stack, Heap and Allocators</a>"
  },
  {
   "type": "mcq",
   "n": 22,
   "q": "Difference between `malloc` and `new` in C++ is:",
   "options": [
    "malloc calls constructors, new does not",
    "new calls constructors, malloc does not",
    "Both call constructors",
    "Both allocate memory only on stack"
   ],
   "answer": 1,
   "session": 3,
   "explanation": "`new` allocates **and** runs the constructor (and throws `std::bad_alloc` on failure). `malloc` only returns raw bytes (and NULL on failure). Both allocate on the heap.",
   "id": "PYQ-22",
   "ref": "<a href=\"../lectures/lecture-03.html\">Session 3: Pointers and References 2: Stack, Heap and Allocators</a>"
  },
  {
   "type": "msq",
   "n": 23,
   "q": "Which optimization is often used to avoid heap allocations? (select all that apply)",
   "options": [
    "Stack-only objects",
    "Singleton pattern",
    "Memory Pool pattern",
    "Global objects"
   ],
   "answers": [
    0,
    2
   ],
   "session": 3,
   "explanation": "**Stack-only objects** need no allocator at all, and a **memory pool** takes one block up front and hands out slots with no per-object `new`. A singleton is about having a single instance, not avoiding allocation, and globals aren't an allocation strategy (the official key marks only these two).",
   "id": "PYQ-23",
   "ref": "<a href=\"../lectures/lecture-03.html\">Session 3: Pointers and References 2: Stack, Heap and Allocators</a>"
  },
  {
   "type": "mcq",
   "n": 24,
   "q": "What does `std::move(x)` do?",
   "options": [
    "Copies x",
    "Casts x to an R-value reference",
    "Deletes x",
    "Converts x to L-value"
   ],
   "answer": 1,
   "session": 6,
   "explanation": "`std::move` moves nothing: it is a `static_cast<T&&>`, an **rvalue cast**. The actual move happens later, if a move constructor or move assignment is chosen.",
   "id": "PYQ-24",
   "ref": "<a href=\"../lectures/lecture-06.html\">Session 6: Metaprogramming and Move Semantics</a>"
  },
  {
   "type": "mcq",
   "n": 25,
   "q": "What is the size of `v1` after this?\n```cpp\nstd::vector<int> v1 = {1,2,3};\nstd::vector<int> v2 = std::move(v1);\n```\n",
   "options": [
    "0",
    "3",
    "6",
    "Error"
   ],
   "answer": 0,
   "session": 6,
   "explanation": "The move constructor steals `v1`'s buffer, so `v1` ends up **empty (size 0)**. Strictly, the standard only promises a \"valid but unspecified\" state, but every real `std::vector` implementation leaves it empty.",
   "id": "PYQ-25",
   "ref": "<a href=\"../lectures/lecture-06.html\">Session 6: Metaprogramming and Move Semantics</a>"
  }
 ],
 "coding": [
  {
   "n": 26,
   "title": "String Class Implementation",
   "session": 6,
   "statement": "Implement a custom `String` class that manages a dynamically allocated character array and correctly implements copy, move, and assignment semantics (**Rule of Five**): deep copies, proper move operations, no leaks or UB.\n\nRequired operations:\n- Default constructor (empty string)\n- Parameterized constructor from `const char*`\n- Copy constructor (deep copy)\n- Move constructor (transfer ownership)\n- Copy assignment (deep copy)\n- Move assignment (transfer, leave the source valid and empty)\n- Destructor (release memory)\n- `size() const` (current length)\n\n**Note:** the starter code below is deliberately **buggy**. Every member has at least one defect (shallow copies, `delete` vs `delete[]`, an uninitialised `length`, moves that copy the pointer without nulling the source). Finding and fixing them is part of the question.",
   "starter": "class String {\nprivate:\n    char* data;\n    size_t length;\n    const char* c;\npublic:\n    String(){ this->data = new char(); }                       // Default constructor\n    String(const char* str) { this->c = str; }                 // Parameterized constructor\n    String(const String& other){ this->data=other.data; this->length=other.length; } // Copy ctor\n    String(String&& other) noexcept { this->data = std::move(other.data); this->length = std::move(other.length); } // Move ctor\n    String& operator=(const String& other) { if(this!=&other){ this->data=other.data; this->length=other.length; } return *this; } // Copy assign\n    String& operator=(String&& other) noexcept { if(this!=&other){ this->data=std::move(other.data); this->length=std::move(other.length); } return *this; } // Move assign\n    ~String(){ delete this->data; }                            // Destructor\n    size_t size() const { return 0; }                          // Return string length\n    const char* c_str() const { return this->c; }              // Return internal string\n};",
   "solution": "#include <cstddef>\n#include <cstring>\n#include <utility>\n\nclass String {\nprivate:\n    char*  data   = nullptr;   // owned buffer, NUL-terminated; nullptr means \"empty\" (e.g. after a move)\n    size_t length = 0;         // number of characters, excluding the '\\0'\n\n    // Deep-copy helper used by every constructor that copies characters.\n    void copyFrom(const char* src, size_t n) {\n        data = new char[n + 1];\n        if (n) std::memcpy(data, src, n);\n        data[n] = '\\0';\n        length = n;\n    }\n\npublic:\n    // Default constructor: empty string. No allocation is needed; c_str() still returns \"\".\n    String() = default;\n\n    // From a C string: deep copy of the characters (+1 for '\\0').\n    String(const char* str) { if (str) copyFrom(str, std::strlen(str)); }\n\n    // Copy constructor: allocate our own buffer and copy the contents.\n    String(const String& other) { if (other.data) copyFrom(other.data, other.length); }\n\n    // Move constructor: steal the pointer, then leave `other` empty (nullptr, 0).\n    // Never allocates, so it is truly noexcept, which lets std::vector move instead of copy.\n    String(String&& other) noexcept\n        : data(std::exchange(other.data, nullptr)), length(std::exchange(other.length, 0)) {}\n\n    // Copy assignment: copy-and-swap. A throwing copy leaves *this unchanged, and it is self-assignment safe.\n    String& operator=(const String& other) {\n        if (this != &other) {\n            String tmp(other);\n            std::swap(data, tmp.data);\n            std::swap(length, tmp.length);\n        }                                   // tmp's destructor frees our old buffer\n        return *this;\n    }\n\n    // Move assignment: release ours, steal theirs, leave the source empty.\n    String& operator=(String&& other) noexcept {\n        if (this != &other) {\n            delete[] data;\n            data   = std::exchange(other.data, nullptr);\n            length = std::exchange(other.length, 0);\n        }\n        return *this;\n    }\n\n    // Destructor: new[] pairs with delete[] (delete[] nullptr is a safe no-op).\n    ~String() { delete[] data; }\n\n    size_t size() const { return length; }\n    const char* c_str() const { return data ? data : \"\"; }\n};",
   "explanation": "**What was wrong with the starter code**, which is the point of the question:\n- **Copy constructor and copy assignment:** copy only the pointer (a *shallow* copy). Two objects then own one buffer, giving a double `delete` and use-after-free.\n- **Moves:** `std::move(other.data)` on a raw pointer is just a copy. The source keeps the pointer, so both destructors free it.\n- **Destructor:** uses `delete` on memory from `new[]`, which is UB. The default constructor uses `new char()`, a single char.\n- **Parameterised constructor:** stores the caller's pointer in `c` and never copies. `data` and `length` stay uninitialised.\n- **`size()`:** always returns 0.\n\n**The fix (Rule of Five):**\n- Every constructor that copies **allocates `length + 1` and `memcpy`s**.\n- **Moves steal the pointer with `std::exchange`** and leave the source `nullptr`/0. They never allocate, so they really are `noexcept`. That matters because `std::vector` only moves elements on growth if the move is `noexcept`; otherwise it copies.\n- **Copy assignment uses copy-and-swap:** it's exception-safe and handles self-assignment.\n- **The destructor uses `delete[]`,** and `delete[] nullptr` is a safe no-op.\n- **`c_str()` returns `\"\"` for an empty string,** so callers never get `nullptr`.\n\nTested with ASan + UBSan and a leak check: deep copy, move, self-assignment, a moved-from string reused, and 100 `push_back`s into a vector.",
   "tests": "#include \"q26.hpp\"\n#include <cassert>\n#include <cstring>\n#include <iostream>\n#include <vector>\nint main() {\n    String e; assert(e.size() == 0 && std::strcmp(e.c_str(), \"\") == 0);\n    String a(\"hello\"); assert(a.size() == 5 && std::strcmp(a.c_str(), \"hello\") == 0);\n    String b(a); assert(std::strcmp(b.c_str(), \"hello\") == 0 && b.c_str() != a.c_str());   // deep copy\n    String c(std::move(b)); assert(std::strcmp(c.c_str(), \"hello\") == 0 && b.size() == 0 && std::strcmp(b.c_str(), \"\") == 0);\n    String d(\"x\"); d = a; assert(std::strcmp(d.c_str(), \"hello\") == 0 && d.c_str() != a.c_str());\n    String& alias = d; d = alias; assert(std::strcmp(d.c_str(), \"hello\") == 0);              // self copy-assign\n    String& malias = a; a = std::move(malias); assert(std::strcmp(a.c_str(), \"hello\") == 0); // self move-assign keeps value\n    String f(\"world\"); f = std::move(d); assert(std::strcmp(f.c_str(), \"hello\") == 0 && d.size() == 0);\n    d = String(\"reuse\"); assert(std::strcmp(d.c_str(), \"reuse\") == 0);                         // moved-from is reusable\n    String n(nullptr); assert(n.size() == 0);\n    std::vector<String> v; for (int i = 0; i < 100; ++i) v.push_back(String(\"abc\"));            // growth uses noexcept move\n    assert(v.back().size() == 3);\n    std::cout << \"ALL TESTS PASSED\\n\";\n}",
   "id": "PYQ-26",
   "ref": "<a href=\"../lectures/lecture-06.html\">Session 6: Metaprogramming and Move Semantics</a>"
  },
  {
   "n": 27,
   "title": "Gardener Harvesting Fruits",
   "session": null,
   "statement": "A gardener harvests fruits in an orchard with |A| trees; the i-th tree carries `A[i]` fruits. The owner returns in `B` hours. The gardener picks a speed `k` fruits/hour: each hour they pick ONE tree and harvest `k` fruits from it (or all remaining fruits if fewer than `k`, and nothing more that hour). Return the **minimum integer k** so that all fruits are harvested within `B` hours.\n\n**Constraints:** `1 <= |A| <= 1e5`; `|A| <= B <= 1e9`; `1 <= A[i] <= 1e9`.\n\n**Input:** array `A`, integer `B`. **Output:** the minimum speed `k`.\n\n**Examples:**\n- `A = [3,6,7,11], B = 8` → `4`\n- `A = [30,11,23,4,20], B = 5` → `30`\n- `A = [30,11,23,4,20], B = 6` → `23`\n\n(Hint from the paper: binary search on k. This is the same problem as LeetCode 875 \"Koko Eating Bananas\".)",
   "starter": "int Solution::minHarvestingSpeed(vector<int> &A, int B) {\n\n}",
   "solution": "#include <vector>\n#include <algorithm>\nusing namespace std;\n\n// Hours needed at speed k: each tree takes ceil(A[i] / k) hours. Sum in 64-bit:\n// with |A| = 1e5 trees and k = 1, the total can reach 1e14, which overflows int.\nstatic long long hoursNeeded(const vector<int>& A, long long k) {\n    long long h = 0;\n    for (int a : A) h += (a + k - 1) / k;\n    return h;\n}\n\nint Solution::minHarvestingSpeed(vector<int>& A, int B) {\n    // Answer is in [1, max(A)]: at k = max(A) every tree takes one hour, and |A| <= B.\n    long long lo = 1, hi = *max_element(A.begin(), A.end());\n    while (lo < hi) {                       // find the smallest k with hoursNeeded(k) <= B\n        long long mid = lo + (hi - lo) / 2;\n        if (hoursNeeded(A, mid) <= B) hi = mid;   // mid works: try slower\n        else lo = mid + 1;                         // too slow: must go faster\n    }\n    return (int)lo;\n}",
   "explanation": "**Binary search on the answer.** If speed `k` finishes in time, every faster speed does too. That monotonicity means we can binary-search the smallest working `k`.\n- **Range:** `k` is in `[1, max(A)]`. At `k = max(A)` every tree takes exactly one hour, and `|A| <= B`, so the top of the range always works.\n- **Hours at speed k:** `sum(ceil(A[i] / k))`, computed as `(A[i] + k - 1) / k`.\n- **Overflow trap:** with 1e5 trees of 1e9 fruits at `k = 1`, the hour total reaches about 1e14, which overflows `int`. Sum in `long long`.\n- **Complexity:** `O(|A| · log(max A))`, about 1e5 × 30 operations.\n\n**Checking example 1** (`A = [3,6,7,11]`, `B = 8`): `k = 4` takes 1 + 2 + 2 + 3 = 8 hours, which fits, but `k = 3` takes 1 + 2 + 3 + 4 = 10, which is too many. So the answer is 4.\n\nThis is the same problem as LeetCode 875 *Koko Eating Bananas*. Tested on all 3 paper examples plus the overflow case.",
   "tests": "#include \"q27.cpp\"\n#include <cassert>\n#include <iostream>\nint main() {\n    Solution s;\n    vector<int> a{3,6,7,11}; assert(s.minHarvestingSpeed(a, 8) == 4);\n    vector<int> b{30,11,23,4,20}; assert(s.minHarvestingSpeed(b, 5) == 30);\n    assert(s.minHarvestingSpeed(b, 6) == 23);\n    vector<int> c(100000, 1000000000); assert(s.minHarvestingSpeed(c, 1000000000) == 100000);  // overflow-prone case\n    vector<int> d{1}; assert(s.minHarvestingSpeed(d, 1) == 1);\n    std::cout << \"ALL TESTS PASSED\\n\";\n}",
   "id": "PYQ-27",
   "ref": ""
  },
  {
   "n": 28,
   "title": "Compile-time Sum",
   "session": 5,
   "statement": "Implement a template metafunction `Sum<N>` such that `Sum<N>::value` equals the sum of the first N natural numbers (1 + 2 + … + N), **computed entirely at compile time using template recursion**.\n\n- `Sum<N>::value` is a `constexpr` integer.\n- Use template recursion and (partial/full) specialization for the base case.\n- No runtime loops or ifs, no dynamic allocation, no I/O.\n- The judge compiles your code and verifies it with `static_assert`; no input/output is required.",
   "starter": "#include <type_traits>\ntemplate <int N>\nstruct Sum; // to be implemented",
   "solution": "#include <type_traits>\n\n// Recursive case: Sum<N> = N + Sum<N-1>, evaluated by the compiler during instantiation.\ntemplate <int N>\nstruct Sum {\n    static constexpr int value = N + Sum<N - 1>::value;\n};\n\n// Base case (full specialization): stops the recursion. Without it the compiler would\n// instantiate Sum<-1>, Sum<-2>, ... until it hits the template-depth limit.\ntemplate <>\nstruct Sum<0> {\n    static constexpr int value = 0;\n};",
   "explanation": "**Template recursion: the compiler does the loop.**\n- `Sum<N>::value` is defined as `N + Sum<N-1>::value`, so instantiating `Sum<5>` makes the compiler instantiate `Sum<4>`, then `Sum<3>`, and so on.\n- The **full specialization `Sum<0>`** is the base case that stops it. Without it, the compiler recurses until it hits the template-depth limit and errors.\n- Everything is a `static constexpr int`, so `static_assert(Sum<100>::value == 5050)` is checked at compile time with zero runtime cost.\n\n**Follow-ups an examiner may ask:**\n- *Why not `if`?* An ordinary `if` is evaluated at run time; the question wants compile time.\n- *Modern alternatives:* a `constexpr` function, or the closed form `N*(N+1)/2`. The question explicitly asks for template recursion plus specialization, though.\n- *Negative N:* it would never reach the base case. You could add `static_assert(N >= 0)` in the primary template.\n\nVerified with `static_assert`s for N = 0, 1, 5, 10, 100.",
   "tests": "#include \"q28.hpp\"\n#include <iostream>\nstatic_assert(Sum<0>::value == 0);\nstatic_assert(Sum<1>::value == 1);\nstatic_assert(Sum<5>::value == 15);\nstatic_assert(Sum<10>::value == 55);\nstatic_assert(Sum<100>::value == 5050);\nstatic_assert(std::is_same_v<decltype(Sum<3>::value), const int>);\nint main() { std::cout << \"ALL TESTS PASSED\\n\"; }",
   "id": "PYQ-28",
   "ref": "<a href=\"../lectures/lecture-05.html\">Session 5: Templates and Generic Programming</a>"
  },
  {
   "n": 29,
   "title": "Single-Producer Single-Consumer Queue",
   "session": 10,
   "statement": "Implement a **lock-free, low-latency Single-Producer Single-Consumer (SPSC) queue** using a circular buffer. Complete the class template `SPSC<T>`:\n\n- `SPSC(size_t size)`: fixed capacity; ensure size is a power of two; allocate the buffer.\n- `~SPSC()`: destroy remaining elements, free memory.\n- `push(const T&)`: insert; return false if full, else true; wait-free for the producer.\n- `pop(T& out)`: remove the next element into `out`; return false if empty, else true; wait-free for the consumer.\n- `empty()`: true if there are no elements. `full()`: true if full.\n\n**Requirements:** no locks, no dynamic allocation in push/pop; exactly one producer and one consumer running concurrently; cache-friendly layout (64-byte alignment for the atomics); memory safe; avoid false sharing.",
   "starter": "template <typename T>\nclass SPSC {\npublic:\n    explicit SPSC(size_t size) { /* TODO: init members, allocate buffer, validate power of two */ }\n    ~SPSC() { /* TODO: clean up remaining elements and free memory */ }\n    bool push(const T& item) noexcept { /* TODO: producer enqueue */ return false; }\n    bool pop(T& out) noexcept { /* TODO: consumer dequeue */ return false; }\n    bool empty() const noexcept { /* TODO */ return false; }\n    bool full() const noexcept { /* TODO */ return false; }\nprivate:\n    alignas(64) std::atomic<size_t> m_head;\n    alignas(64) std::atomic<size_t> m_tail;\n    size_t m_size = 0;\n    size_t m_mask = 0;\n    T* m_buffer = nullptr;\n};",
   "solution": "#include <atomic>\n#include <cstddef>\n#include <new>\n#include <stdexcept>\n#include <memory>\n\ntemplate <typename T>\nclass SPSC {\npublic:\n    explicit SPSC(size_t size) : m_size(size), m_mask(size - 1) {\n        if (size < 2 || (size & (size - 1)) != 0)            // power of two => index & mask == index % size\n            throw std::invalid_argument(\"SPSC size must be a power of two >= 2\");\n        m_head.store(0, std::memory_order_relaxed);\n        m_tail.store(0, std::memory_order_relaxed);\n        // Raw, suitably aligned storage: no T is constructed until push().\n        m_buffer = static_cast<T*>(::operator new(sizeof(T) * size, std::align_val_t{alignof(T)}));\n    }\n\n    ~SPSC() {\n        // Destroy the elements still in the queue, then free the raw block.\n        size_t head = m_head.load(std::memory_order_relaxed);\n        size_t tail = m_tail.load(std::memory_order_relaxed);\n        for (; head != tail; ++head) std::destroy_at(&m_buffer[head & m_mask]);\n        ::operator delete(m_buffer, std::align_val_t{alignof(T)});\n    }\n\n    SPSC(const SPSC&) = delete;\n    SPSC& operator=(const SPSC&) = delete;\n\n    // Producer only. m_head/m_tail are ever-increasing counters; the slot is counter & mask.\n    bool push(const T& item) noexcept {\n        const size_t tail = m_tail.load(std::memory_order_relaxed);   // we own tail: relaxed is enough\n        const size_t head = m_head.load(std::memory_order_acquire);   // see the consumer's frees\n        if (tail - head == m_size) return false;                       // full\n        ::new (static_cast<void*>(&m_buffer[tail & m_mask])) T(item);  // construct in place\n        m_tail.store(tail + 1, std::memory_order_release);             // publish: element is visible\n        return true;\n    }\n\n    // Consumer only.\n    bool pop(T& out) noexcept {\n        const size_t head = m_head.load(std::memory_order_relaxed);   // we own head\n        const size_t tail = m_tail.load(std::memory_order_acquire);   // see the producer's writes\n        if (head == tail) return false;                                // empty\n        T* slot = &m_buffer[head & m_mask];\n        out = std::move(*slot);\n        std::destroy_at(slot);\n        m_head.store(head + 1, std::memory_order_release);             // hand the slot back\n        return true;\n    }\n\n    bool empty() const noexcept {\n        return m_head.load(std::memory_order_acquire) == m_tail.load(std::memory_order_acquire);\n    }\n    bool full() const noexcept {\n        return m_tail.load(std::memory_order_acquire) - m_head.load(std::memory_order_acquire) == m_size;\n    }\n\nprivate:\n    alignas(64) std::atomic<size_t> m_head;   // written only by the consumer\n    alignas(64) std::atomic<size_t> m_tail;   // written only by the producer; own cache line => no false sharing\n    alignas(64) size_t m_size = 0;            // read-only after construction\n    size_t m_mask = 0;\n    T* m_buffer = nullptr;\n};",
   "explanation": "**Design:** a ring buffer whose two indices only ever grow. The slot is `index & mask`, and a power-of-two size makes `& mask` equal to `% size`, which is cheaper.\n- **Empty** is `head == tail`; **full** is `tail - head == size`. Using counters instead of wrapped indices means there's no \"one wasted slot\" trick.\n- **Producer (`push`):**\n  1. Read its own `tail` with **relaxed** ordering; only it writes `tail`.\n  2. Read `head` with **acquire**, so it sees the consumer's frees.\n  3. Placement-new the item into the slot.\n  4. Store `tail + 1` with **release**. That publishes the element: release on tail pairs with acquire in `pop`.\n- **Consumer (`pop`)** mirrors this: relaxed `head`, acquire `tail`, move the item out, destroy it, then release `head + 1`.\n- **No locks and no allocation on the hot path.** The buffer is raw `::operator new` memory, taken once. Elements are constructed in `push` and destroyed in `pop` or in the destructor (which destroys anything still queued).\n- **`alignas(64)`** on `m_head`, `m_tail` and the read-only fields puts each on its own cache line. Producer and consumer writes then don't invalidate each other's line (no false sharing, as in PYQ Q4 and Q5).\n- **Exactly one producer and one consumer** is what makes this correct without compare-and-swap. Two producers would race on `tail`.\n\nTested: full and empty edges, power-of-two validation, destruction of leftover `std::string`s, and 2,000,000 items between two threads with order and checksum checked, under **ThreadSanitizer** (0 reports) and ASan/UBSan.",
   "tests": "#include \"q29.hpp\"\n#include <cassert>\n#include <iostream>\n#include <string>\n#include <thread>\nint main() {\n    { SPSC<int> q(4); int x;\n      assert(q.empty() && !q.full() && !q.pop(x));\n      for (int i = 0; i < 4; ++i) assert(q.push(i));\n      assert(q.full() && !q.push(99));\n      for (int i = 0; i < 4; ++i) { assert(q.pop(x) && x == i); }\n      assert(q.empty()); }\n    { bool threw = false; try { SPSC<int> bad(6); } catch (const std::invalid_argument&) { threw = true; } assert(threw); }\n    { SPSC<std::string> q(8); q.push(\"left\"); q.push(\"in\"); q.push(\"queue\"); }     // destructor must free these\n    { SPSC<long> q(1024); const long N = 2000000;\n      std::thread prod([&] { for (long i = 0; i < N; ) if (q.push(i)) ++i; });\n      long sum = 0, expect = 0, v;\n      for (long got = 0; got < N; ) if (q.pop(v)) { assert(v == got); sum += v; ++got; }\n      prod.join(); for (long i = 0; i < N; ++i) expect += i; assert(sum == expect); }\n    std::cout << \"ALL TESTS PASSED\\n\";\n}",
   "id": "PYQ-29",
   "ref": "<a href=\"../lectures/lecture-10.html\">Session 10: Atomics and Concurrency 2</a>"
  }
 ],
 "diagram": {
  "n": 30,
  "title": "Variable Access Flow",
  "session": 8,
  "statement": "We have a process P in which the program wants to **edit a variable `x = 12` and then read it again**. Draw a visual diagram showing what happens internally. Consider how data moves through: **Page Table, TLB (Translation Lookaside Buffer), ILB (Instruction Lookaside Buffer), RAM, Frame, Cache Lines, L1/L2/L3 caches**. Show the complete path of the memory access from the CPU instruction request to data retrieval and back, highlighting the **write** and **read** operations separately. No code required: draw the diagram clearly.",
  "answer": "**Model answer.** Draw it as two passes: the **WRITE** of `x = 12` first, then the **READ**.\n\n```\n            CPU core  (instruction: mov [x], 12   then   mov eax, [x])\n               |\n      (1) instruction fetch: the code address itself goes through the I-TLB (\"ILB\")\n               |                -> instruction bytes come from the L1 instruction cache\n               v\n      (2) data address of x = VIRTUAL address  --->  D-TLB lookup\n               |                                    |\n           TLB HIT                               TLB MISS\n               |                                    v\n               |                     (3) page-table walk (page table in RAM)\n               |                          page number -> FRAME number\n               |                          (page not present -> PAGE FAULT -> OS loads\n               |                           the page into a frame, updates the table)\n               |                          translation is cached in the TLB\n               v                                    |\n      physical address = frame number + offset  <---+\n               |\n               v\n      (4) L1 data cache  --miss-->  L2  --miss-->  L3  --miss-->  RAM (frame)\n               ^                                                    |\n               +---- whole 64-byte CACHE LINE copied back up -------+\n```\n\n**WRITE `x = 12`:**\n1. Translate the address (TLB, or a page-table walk on a miss).\n2. On an L1 miss, the line is first fetched (*write-allocate*) from L2 → L3 → RAM into L1.\n3. The CPU writes 12 into **its L1 copy** and marks the line **Modified** (MESI); copies in other cores' caches are invalidated.\n4. RAM is **not** updated yet: x86 caches are *write-back*. The dirty line is written down to L2/L3/RAM only when it's evicted.\n\n**READ `x` again:**\n1. The TLB now hits, because the translation was just cached.\n2. L1 hits, because the line is still there and Modified.\n3. 12 comes back to the register in about 1 ns, with no RAM access at all. That's temporal locality.\n\n**Points the examiner looks for:**\n- The order is **TLB → page table → cache → RAM** (PYQ Q6).\n- A **page** is virtual and a **frame** is physical (Q10).\n- Data moves in **64-byte lines** (Q9, Q11).\n- The **I-TLB** handles instruction fetch while the **D-TLB** handles data.\n- A **page fault** happens only when the page isn't in RAM.\n- Writes are write-back, plus MESI invalidation.\n- Rough latencies: L1 ~1 ns, L2 ~4 ns, L3 ~10–20 ns, RAM ~60–100 ns.\n",
  "id": "PYQ-30",
  "ref": "<a href=\"../lectures/lecture-08.html\">Session 8: Computer Architecture for HFT</a>"
 }
};
