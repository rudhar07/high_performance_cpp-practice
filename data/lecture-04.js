window.PAGE = {
 "num": 4,
 "title": "Memory Management + STL",
 "summary": "A tour of the STL containers (array, vector, deque, list, map, unordered_map and the adaptors) with their memory layouts, complexities and iterator-invalidation rules, and how to choose between them. It also covers iterators and the core algorithms, plus the practical performance rules: reserve, contiguous over node-based, std::array vs vector, and avoiding hidden allocations and copies.",
 "notes": [
  {
   "heading": "The STL at a glance",
   "body": "The Standard Template Library has three parts that fit together: **containers** hold data, **iterators** are generalised pointers into containers, and **algorithms** are generic functions over iterator ranges. Because everything is a template, `std::sort(v.begin(), v.end())` is instantiated for your exact type and fully inlined. That is often faster than C's `qsort`, which calls the comparator through a function pointer.\n\n| Category | Containers |\n|---|---|\n| Sequence | `array`, `vector`, `deque`, `list`, `forward_list` |\n| Ordered associative (red-black tree) | `set`, `map`, `multiset`, `multimap` |\n| Unordered associative (hash table) | `unordered_set`, `unordered_map` (+ multi versions) |\n| Adaptors | `stack`, `queue` (default on `deque`), `priority_queue` (default on `vector`) |\n| C++23 flat containers | `flat_map`, `flat_set`: sorted vectors behind a map interface |\n\nThe performance story of this session is one sentence: **contiguous memory wins**. A cache line is 64 B, the hardware prefetcher loves sequential access, and every pointer hop in a node-based container risks a ~60–100 ns DRAM miss."
  },
  {
   "heading": "std::array",
   "body": "```cpp\n#include <array>\nstd::array<int, 4> a{1, 2, 3, 4};   // fixed size, part of the type\na.size();          // 4, constexpr\na[2]; a.at(9);     // unchecked / throws std::out_of_range\nauto b = a;        // copyable and assignable (a C array is not)\nvoid f(const std::array<int, 4>& x);   // no decay: the size travels with the type\n```\n\n- It is a struct wrapping a C array: **zero overhead**, the same layout as `int[4]`, and it lives wherever the object lives (stack, static or inside another object). No heap.\n- Compared with a C array it adds value semantics (copy, assign, `==`), `.size()`, iterators, no decay to a pointer, and `std::get<I>`.\n- The size is a compile-time constant, so the compiler can fully unroll loops and keep small arrays in registers.\n- Use it for fixed-size buffers: a ring buffer of 1024 slots, a fixed book depth of 10 levels, lookup tables."
  },
  {
   "heading": "std::vector in depth",
   "body": "```cpp\nstd::vector<Order> v;\nv.reserve(10'000);                 // capacity >= 10000, size 0: one allocation\nv.push_back(Order{1, 100, 5});     // copy or move an existing object in\nv.emplace_back(2, 101, 7);         // construct in place from constructor arguments\nv.resize(20'000);                  // size 20000: new elements value-initialised\nv.shrink_to_fit();                 // non-binding request to drop spare capacity\nv.erase(v.begin() + 3);            // O(n): shifts every later element left\nv.clear();                         // size 0, capacity unchanged (memory kept)\n```\n\n- **Layout:** three pointers (begin, end, capacity end: 24 B) plus one contiguous heap buffer, so `&v[0]` can be passed to C APIs.\n- **Growth:** when full, it allocates a new buffer a constant factor larger (libstdc++/libc++ **2×**, MSVC **1.5×**), moves or copies the elements, then frees the old one. Total work over n pushes is O(n), so push_back is **amortised O(1)**, but the push that triggers growth is O(n) and invalidates everything.\n- **Moves during growth:** elements are *moved* only if their move constructor is `noexcept` (`std::move_if_noexcept`), otherwise copied, to keep the strong exception guarantee. **Mark your move constructors `noexcept`.**\n- **Complexity:** `[]` and `back()` O(1). `push_back`/`pop_back` amortised O(1). Insert or erase in the middle O(n), but a fast O(n): a `memmove` of contiguous memory.\n- **`reserve` vs `resize`:** `reserve(n)` sets capacity only. `resize(n)` changes size and constructs elements.\n- **`vector<bool>`** is a special case: a packed bitset whose `operator[]` returns a proxy, not a `bool&`. `auto& b = v[0];` doesn't compile, and separate elements are not safe to write from different threads. Use `vector<char>` or `std::bitset` when that matters."
  },
  {
   "heading": "std::deque",
   "body": "```cpp\nstd::deque<int> d;\nd.push_back(1); d.push_front(0);   // both O(1)\nd[5];                              // O(1) random access (two-level lookup)\n```\n\n- **Layout:** a map (array) of pointers to fixed-size blocks (libstdc++ uses 512-byte blocks, so 128 ints). It is *not* contiguous overall, so it cannot be handed to a C API as one buffer.\n- **O(1) push and pop at both ends.** Growing never relocates existing elements, so **`push_back`/`push_front` keep references and pointers to elements valid** (they do invalidate *iterators*).\n- Random access costs an extra indirection compared with `vector` (block lookup, then offset). Iteration is still fairly cache-friendly, block by block.\n- Insert or erase in the middle is O(n) and invalidates everything.\n- Default backing container of `std::queue` and `std::stack`. Good for a FIFO that grows, and when you need stable references while appending."
  },
  {
   "heading": "std::list and std::forward_list",
   "body": "```cpp\nstd::list<Order> l;\nauto it = l.insert(l.end(), Order{1, 100, 5}); // O(1) given a position\nl.erase(it);                                   // O(1); only this element's iterators die\nl.splice(l.begin(), other, other.begin());     // O(1): move nodes between lists, no copy\nl.sort();                                      // member sort: std::sort needs random access\n```\n\n- **Layout:** each element is a separately allocated **node** with `prev` and `next` pointers. That is 16 B of links plus malloc overhead per element, so a `list<int>` uses roughly 32 B or more per 4-byte int.\n- **Strengths:** O(1) insert, erase and splice at a known position, and **iterators and references stay valid** except for erased elements. This is why order books traditionally keep a FIFO of orders at each price level as an (intrusive) linked list: cancel by iterator in O(1) while keeping time priority.\n- **Weaknesses:** no random access (no `[]`, and finding the k-th element is O(n)). Every step is a dependent pointer load, likely a cache miss. One allocation per insert. Traversal is often **10× or more slower than a vector**.\n- `forward_list` is singly linked (8 B link) and has `insert_after`/`erase_after` only, with no `size()`.\n- Bjarne Stroustrup's well-known benchmark: inserting into the middle of a sorted sequence is *faster with a vector* than with a list for realistic sizes, because the list's linear search to find the position is dominated by cache misses."
  },
  {
   "heading": "std::map and std::set (ordered, red-black tree)",
   "body": "```cpp\nstd::map<int64_t, int64_t> asks;                      // price -> total qty, ascending\nstd::map<int64_t, int64_t, std::greater<>> bids;      // descending: best bid first\nasks[10050] += 300;                    // operator[] INSERTS a default value if the key is missing\nif (auto it = asks.find(10050); it != asks.end()) it->second -= 100;\nauto best_ask = asks.begin()->first;   // smallest key in O(1) (leftmost node is cached)\nauto it = asks.lower_bound(10040);     // first key >= 10040, O(log n)\nasks.erase(it);                        // O(1) amortised given the iterator\nif (asks.contains(10050)) {}           // C++20\n```\n\n- A **self-balancing red-black tree**: O(log n) find, insert and erase. Keys are kept **sorted**, so in-order iteration and range queries (`lower_bound`/`upper_bound`) are natural.\n- **Node per element**: 3 pointers + a colour (~32 B) + the pair, with one allocation per insert. Lookups chase about log2(n) pointers, each a potential cache miss.\n- **Iterator and reference stability:** insert never invalidates, and erase invalidates only the erased element.\n- **`operator[]`** is non-const and inserts a default value. Use `find`, `at` or `contains` for read-only lookups.\n- `multimap`/`multiset` allow duplicate keys.\n- Order books: `std::map<Price, Level>` is the textbook structure (best price at `begin()`), but production books often use arrays indexed by price tick or sorted vectors for cache efficiency (session 12)."
  },
  {
   "heading": "std::unordered_map and std::unordered_set (hash tables)",
   "body": "```cpp\nstd::unordered_map<uint64_t, Order*> by_id;   // order id -> order: the classic cancel/modify lookup\nby_id.reserve(1'000'000);                     // pre-size the buckets: no rehash during trading\nby_id.emplace(42, ptr);\nif (auto it = by_id.find(42); it != by_id.end()) { /* ... */ }\nby_id.erase(42);\n```\n\n- **Average O(1)** find, insert and erase. The **worst case is O(n)** (everything hashes to one bucket, or an adversarial key pattern).\n- libstdc++ uses **separate chaining**: a bucket array plus one heap-allocated node per element (with the cached hash for some key types). So every insert allocates, and every lookup is hash, bucket load, node load: two or more dependent memory accesses.\n- **Rehash:** when `size() > bucket_count() * max_load_factor()` (default 1.0), the table rebuilds (O(n), a latency spike). Rehash **invalidates iterators but not references or pointers** to elements. `reserve(n)` up front avoids it.\n- Unordered: iteration order is unspecified and may change after a rehash.\n- The hash function matters: `std::hash<int>` is the identity in libstdc++. That is fine for random ids but can cluster badly with structured keys under power-of-two bucket schemes.\n- Faster production alternatives use **open addressing** with flat storage (`absl::flat_hash_map`, `boost::unordered_flat_map`, robin-hood maps): no node allocations, better cache behaviour."
  },
  {
   "heading": "Container adaptors: stack, queue, priority_queue",
   "body": "```cpp\nstd::stack<int> s;  s.push(1); s.top(); s.pop();     // LIFO, default on deque\nstd::queue<int> q;  q.push(1); q.front(); q.pop();   // FIFO, default on deque\nstd::priority_queue<int> maxh;                        // max-heap on vector: top() is largest\nstd::priority_queue<int, std::vector<int>, std::greater<int>> minh;  // min-heap\nmaxh.push(5); maxh.top(); maxh.pop();\n```\n\n- Adaptors restrict an underlying container's interface. They have no iterators.\n- `priority_queue` is a **binary heap** in a vector: `top()` O(1), `push`/`pop` O(log n), building from n elements O(n). It **cannot erase an arbitrary element** or change a priority. That is why order-book designs with a heap use **lazy deletion**: mark cancelled orders and skip them when they reach the top.\n- `pop()` returns `void`. Read `top()` first."
  },
  {
   "heading": "Comparison table: complexity, layout and invalidation",
   "body": "| Container | Layout | Access | Insert/erase | Iterator/reference invalidation | Typical use |\n|---|---|---|---|---|---|\n| `array` | contiguous, inline | O(1) | n/a (fixed) | never (no resizing) | fixed buffers, LUTs |\n| `vector` | contiguous heap buffer | O(1) | end amortised O(1); middle O(n) | on reallocation: **all**; otherwise at or after the point | default choice |\n| `deque` | blocks of contiguous chunks | O(1) (2 hops) | both ends O(1); middle O(n) | end push: iterators invalid, **references valid** | FIFO queues |\n| `list` | node per element | O(n) | O(1) at an iterator | only erased elements | stable handles, splicing |\n| `map`/`set` | red-black tree nodes | O(log n) | O(log n) | only erased elements | sorted keys, ranges |\n| `unordered_map` | buckets + chained nodes | avg O(1), worst O(n) | avg O(1) | rehash: iterators invalid, **references valid** | id lookup |\n| `priority_queue` | heap in a vector | top O(1) | push/pop O(log n) | no iterators | best element |\n\nMemory overhead per element (64-bit, libstdc++, beyond the element itself):\n\n| Container | Overhead |\n|---|---|\n| `vector` | about 0 (plus spare capacity, up to 2×) |\n| `deque` | about 0 (plus block map) |\n| `list` | 16 B links + malloc header |\n| `map` | ~32 B node header + malloc header |\n| `unordered_map` | 8 B next + bucket slot (+ cached hash) + malloc header |"
  },
  {
   "heading": "Choosing the right container",
   "body": "1. **Default to `std::vector`.** It is contiguous, prefetchable and has the smallest overhead. It wins most benchmarks, even many that \"should\" favour a list or map at small and medium n.\n2. **Size known at compile time?** Use `std::array` (no heap, unrollable).\n3. **Need fast lookup by key?**\n   - Unordered, point lookups: `unordered_map` (better still, a flat open-addressing map), with `reserve()` up front.\n   - Ordered iteration or range queries (best price, `lower_bound`): `std::map`, or a **sorted vector** with `std::lower_bound` if reads dominate writes (C++23 `flat_map`).\n   - Small key sets (say under 64 elements): a linear scan over a vector often beats both.\n   - Dense integer keys (price ticks, small ids): a **plain array indexed by key**, O(1) with no hashing.\n4. **Push or pop at both ends?** `deque`, or a fixed-capacity ring buffer over `std::array` for zero allocation.\n5. **Need stable iterators or references while inserting and erasing, or O(1) splice?** `list` (in HFT usually an *intrusive* list over pooled nodes, to avoid per-node allocation).\n6. **Always want the max or min?** `priority_queue`.\n\nQuestions to ask: what are the dominant operations, how big is n, must references stay valid, is iteration order needed, and can it be pre-sized? Then **measure**."
  },
  {
   "heading": "Iterators",
   "body": "An iterator is a generalised pointer: `*it` accesses the element, `++it` advances, and `it1 == it2` compares. Ranges are **half-open** `[begin, end)`: `end()` is one past the last element and must not be dereferenced.\n\n| Category | Operations | Containers |\n|---|---|---|\n| Input / Output | single pass read / write | `istream_iterator` / `back_inserter` |\n| Forward | multi-pass, `++` | `forward_list`, `unordered_*` |\n| Bidirectional | `++`, `--` | `list`, `map`, `set` |\n| Random access | `it + n`, `it[n]`, `<`, `it2 - it1` in O(1) | `deque` |\n| Contiguous (C++20) | random access + adjacent in memory | `vector`, `array`, `string` |\n\n```cpp\nfor (auto it = v.begin(); it != v.end(); ++it) *it *= 2;\nfor (auto& x : v) x *= 2;                         // range-for = the loop above\nfor (auto it = v.cbegin(); it != v.cend(); ++it); // const_iterator: read-only\nfor (auto it = v.rbegin(); it != v.rend(); ++it); // reverse\n\n// erase while iterating: use the iterator erase returns\nfor (auto it = m.begin(); it != m.end(); )\n    if (it->second == 0) it = m.erase(it); else ++it;\n\n// erase-remove idiom (vector): O(n), one pass\nv.erase(std::remove_if(v.begin(), v.end(), [](int x){ return x < 0; }), v.end());\nstd::erase_if(v, [](int x){ return x < 0; });     // C++20 equivalent\n```\n\n- **Invalidation is the biggest source of bugs.** For example, holding `&v[0]` or an iterator across a `push_back` that reallocates leaves you a dangling pointer.\n- The algorithm's requirements decide what you can call: `std::sort` needs random-access iterators, which is why `list` has a member `.sort()`.\n- `std::lower_bound` on `map` iterators works but takes O(n) steps (bidirectional). Use the member `m.lower_bound(k)`, which is O(log n)."
  },
  {
   "heading": "Algorithms",
   "body": "```cpp\n#include <algorithm>\n#include <numeric>\nstd::sort(v.begin(), v.end());                          // introsort: O(n log n) worst case\nstd::sort(v.begin(), v.end(), [](const Order& a, const Order& b){ return a.px > b.px; });\nstd::stable_sort(v.begin(), v.end(), cmp);              // keeps equal elements' order (time priority!)\nstd::partial_sort(v.begin(), v.begin() + 10, v.end());  // top 10 sorted: O(n log k)\nstd::nth_element(v.begin(), v.begin() + n/2, v.end());  // median in average O(n)\nauto it = std::lower_bound(v.begin(), v.end(), 100);    // first >= 100 in a SORTED range, O(log n)\nbool found = std::binary_search(v.begin(), v.end(), 100);\nauto f = std::find(v.begin(), v.end(), 42);             // linear O(n)\nlong total = std::accumulate(v.begin(), v.end(), 0L);   // note 0L: the accumulator type is the init's type\nauto mx = std::max_element(v.begin(), v.end());\nint cnt = std::count_if(v.begin(), v.end(), [](int x){ return x > 0; });\nstd::transform(a.begin(), a.end(), b.begin(), [](int x){ return x * 2; });\nstd::sort(v.begin(), v.end()); v.erase(std::unique(v.begin(), v.end()), v.end()); // dedupe\nstd::ranges::sort(v);                                    // C++20 ranges version\n```\n\n- Prefer algorithms to hand-written loops: they are correct, they say what you mean, and they are inlined (a lambda comparator is inlined, unlike `qsort`'s function pointer).\n- `std::sort` is **not stable**. Use `stable_sort` when equal keys must keep insertion order (price-time priority).\n- The `lower_bound`/`upper_bound`/`binary_search` family requires a range **sorted by the same comparator**.\n- `std::accumulate(v.begin(), v.end(), 0)` with doubles truncates to `int`, because the type comes from the initial value.\n- `std::remove` does not erase. It moves the kept elements forward and returns the new logical end.\n- C++17 parallel algorithms: `std::sort(std::execution::par, ...)`."
  },
  {
   "heading": "Practical performance considerations",
   "body": "**1. `reserve` for vectors.** Without it, filling 1M elements does about 20 reallocations (log2 of 1M), each allocating, moving everything and freeing, with latency spikes and invalidated pointers. With `reserve(1'000'000)` there is one allocation at start-up.\n\n```cpp\nstd::vector<Order> v;  v.reserve(expected);    // do this at start-up\nstd::unordered_map<uint64_t, Order*> m;  m.reserve(expected);   // also for hash maps\n```\n\n**2. Vectors vs static arrays (`std::array` / C arrays).**\n\n| | `std::vector` | `std::array` / static array |\n|---|---|---|\n| Storage | heap (allocation at construction) | inline: stack, static or inside the object |\n| Access | load the data pointer, then the element (usually hoisted out of loops) | direct offset from `rsp` or a global address |\n| Size | run time, can grow | compile time, fixed |\n| Optimiser | unknown trip count | known size: full unrolling, constant folding |\n| Locality inside a struct | elements live elsewhere (indirection) | elements embedded in the struct |\n\nFor fixed-capacity hot data (ring buffers, top-of-book levels, per-symbol tables) prefer `std::array`. Use `vector` when the size is only known at run time, but `reserve` it once.\n\n**3. Construct in place and avoid copies.** Use `emplace_back(args...)`, pass by `const&`, `std::move` into containers, and iterate with `for (const auto& x : v)`, not `for (auto x : v)`.\n\n**4. Cache behaviour beats big-O at small n.** A linear scan of 32 ints (two cache lines) beats a `std::map` lookup (several pointer hops). Benchmark before reaching for a tree.\n\n**5. Struct of arrays vs array of structs.** If a hot loop reads only `price`, a separate `std::vector<int64_t> prices` packs 8 prices per cache line instead of 2 or 3 whole `Order`s.\n\n**6. Hidden allocations:** `map`/`list`/`unordered_map` insert one node per element, and `std::string` keys beyond SSO allocate. Pre-size, pool, or use flat containers.\n\n**7. `std::endl` and `at()`** in hot loops add a flush and bounds checks. Use `[]` once correctness is proven, and keep `at()` or sanitizers in debug builds."
  },
  {
   "heading": "Quick revision",
   "body": "- Containers, iterators and algorithms are templates, so they are inlined and zero-cost compared with `qsort`'s function pointer.\n- `array`: fixed size, inline, no heap, no decay, copyable.\n- `vector`: contiguous with 2× growth (libstdc++). push_back is amortised O(1). Middle insert is O(n).\n- Reallocation invalidates all vector iterators, pointers and references.\n- A vector moves elements on growth only if the move constructor is `noexcept`.\n- `reserve` sets capacity and `resize` sets size. Pre-size at start-up.\n- `deque`: chunked, O(1) at both ends, references stay valid on end pushes.\n- `list`: node per element, O(1) insert and erase at an iterator, stable iterators, cache-hostile, no random access.\n- `map`/`set`: red-black tree, O(log n), sorted, stable iterators, about 32 B per node plus an allocation.\n- `map::operator[]` inserts if the key is missing.\n- `unordered_map`: average O(1) and worst O(n). Rehash invalidates iterators, not references. Use `reserve`.\n- `priority_queue`: binary heap. top is O(1), push and pop O(log n), no arbitrary erase (so lazy deletion).\n- Iterator categories: forward, bidirectional (`list`, `map`), random access (`deque`), contiguous (`vector`).\n- Ranges are half-open `[begin, end)`.\n- Erase while iterating with `it = c.erase(it)`. Use erase-remove or `std::erase_if` on a vector.\n- `sort` is introsort, O(n log n), not stable. `stable_sort` keeps order. `nth_element` is average O(n).\n- `lower_bound` needs a sorted range. Use the member `map::lower_bound`.\n- Default to vector. Use `array` for a fixed size, a flat or array-indexed structure for dense keys, and measure."
  },
  {
   "heading": "Exam traps",
   "body": "- **Keeping `&v[0]` or an iterator across `push_back`** leaves it dangling once a reallocation happens.\n- **`v.reserve(n); v[0] = 1;`** is UB because size is still 0.\n- **`map[key]` for a lookup** silently inserts a default value (and can't be used on a `const map`).\n- **`std::sort(list.begin(), list.end())`** does not compile, because it needs random-access iterators. Use `list.sort()`.\n- **`std::remove` without `erase`** leaves the size unchanged.\n- **`auto& b = vb[0]` on a `vector<bool>`** does not compile, because it returns a proxy.\n- **\"`unordered_map` is always O(1)\":** that is the average. The worst case is O(n), and a rehash is an O(n) spike.\n- **\"`deque` is contiguous\":** no, it is chunked. You can't pass `&d[0]` as a buffer.\n- **\"`list` is best for middle inserts\":** only if you already hold the iterator. Finding the spot is O(n) with a cache miss per node, and a vector usually wins.\n- **`std::accumulate(v.begin(), v.end(), 0)` on doubles** truncates. Use `0.0`.\n- **`std::lower_bound` on an unsorted vector** gives a meaningless result.\n- **Erasing in a range-for loop** (`for (auto& x : m) m.erase(...)`) invalidates the loop's iterator: UB.\n- **`priority_queue::pop()` returns void.** Read `top()` first. The default is a **max**-heap.\n- **A move constructor without `noexcept`** makes vector growth *copy* the elements.\n- **`for (auto x : bigVector)`** copies each element. Use `const auto&`."
  }
 ],
 "keyTerms": [
  {
   "term": "Container",
   "def": "A class template that owns a collection of elements (vector, map…)."
  },
  {
   "term": "Iterator",
   "def": "A generalised pointer into a container that supports *, ++ and comparison. Ranges are half-open [begin, end)."
  },
  {
   "term": "Iterator invalidation",
   "def": "When a container operation makes existing iterators, pointers or references unusable (e.g. vector reallocation)."
  },
  {
   "term": "Amortised O(1)",
   "def": "Average cost per operation over a sequence is constant, even though individual operations (reallocation) may be O(n)."
  },
  {
   "term": "Growth factor",
   "def": "The multiplier applied to a vector's capacity on reallocation: 2× in libstdc++ and libc++, 1.5× in MSVC."
  },
  {
   "term": "reserve",
   "def": "Pre-allocates capacity without changing size, avoiding reallocations and invalidation while filling."
  },
  {
   "term": "emplace_back",
   "def": "Constructs an element in place at the end from constructor arguments, avoiding a temporary."
  },
  {
   "term": "std::deque",
   "def": "A double-ended queue stored as fixed-size blocks. O(1) push and pop at both ends, and not contiguous."
  },
  {
   "term": "std::list",
   "def": "A doubly linked list with a node per element. O(1) insert and erase at an iterator, with stable iterators."
  },
  {
   "term": "Red-black tree",
   "def": "A self-balancing BST used by std::map and std::set. Guarantees O(log n) operations."
  },
  {
   "term": "Separate chaining",
   "def": "Hash table collision strategy in which each bucket points to a linked list of nodes (libstdc++ unordered_map)."
  },
  {
   "term": "Open addressing",
   "def": "Hash table strategy that stores elements directly in a flat array and probes for free slots. Cache-friendly."
  },
  {
   "term": "Load factor",
   "def": "size() / bucket_count(). Exceeding max_load_factor (default 1.0) triggers a rehash."
  },
  {
   "term": "Rehash",
   "def": "Rebuilding a hash table with more buckets: O(n), and it invalidates iterators (but not references)."
  },
  {
   "term": "Binary heap",
   "def": "Array-based complete tree used by priority_queue. top is O(1), push and pop O(log n)."
  },
  {
   "term": "Lazy deletion",
   "def": "Marking elements as deleted and skipping them later, used when a structure (like a heap) can't erase arbitrary elements."
  },
  {
   "term": "Introsort",
   "def": "The algorithm behind std::sort: quicksort that falls back to heapsort (and insertion sort for small ranges), O(n log n) worst case."
  },
  {
   "term": "Erase-remove idiom",
   "def": "v.erase(std::remove_if(...), v.end()): compacts the kept elements, then trims the tail in one O(n) pass."
  },
  {
   "term": "Flat map",
   "def": "A sorted-vector-backed associative container (C++23 std::flat_map), with fast lookups and iteration but O(n) inserts."
  },
  {
   "term": "Contiguous iterator",
   "def": "C++20 iterator category guaranteeing elements are adjacent in memory (vector, array, string)."
  }
 ],
 "mcqs": [
  {
   "q": "Which container should be your default choice for a sequence of elements in performance-sensitive C++?",
   "options": [
    "std::list",
    "std::vector",
    "std::deque",
    "std::map"
   ],
   "answer": 1,
   "explanation": "vector is contiguous, has minimal overhead and is prefetch-friendly. It wins most real benchmarks until a specific need (stable iterators, keyed lookup, both-end pushes) says otherwise.",
   "distractors": "list and map pay a pointer hop per element. deque adds a level of indirection and isn't contiguous.",
   "source": "lecture",
   "id": "L04-m1"
  },
  {
   "q": "What is the amortised and worst-case cost of a single `std::vector::push_back`?",
   "options": [
    "O(1) amortised, O(n) worst case (when it reallocates)",
    "O(log n) amortised, O(n) worst case",
    "O(1) always",
    "O(n) always"
   ],
   "answer": 0,
   "explanation": "Geometric growth spreads the copying cost over all pushes, but the push that triggers reallocation moves all n elements.",
   "distractors": "'O(1) always' ignores reallocation. O(n) always would need +1 growth.",
   "source": "lecture",
   "id": "L04-m2"
  },
  {
   "q": "What does this print (libstdc++)?\n\n    std::vector<int> v;\n    v.reserve(4);\n    for (int i = 0; i < 5; ++i) v.push_back(i);\n    std::cout << v.size() << ' ' << v.capacity();",
   "options": [
    "5 5",
    "4 8",
    "5 8",
    "5 6"
   ],
   "answer": 2,
   "explanation": "The size is 5. The 5th push exceeds capacity 4, and libstdc++ doubles it to 8.",
   "distractors": "Capacity never shrinks to the exact size on growth, and 1.5× growth (MSVC) would give 6.",
   "source": "lecture",
   "id": "L04-m3"
  },
  {
   "q": "Is this code safe?\n\n    std::vector<int> v{1, 2, 3};\n    int* p = &v[0];\n    v.push_back(4);\n    std::cout << *p;",
   "options": [
    "Yes, p always points to v[0]",
    "It is a compile error",
    "Yes, because ints are trivially copyable",
    "No: push_back may reallocate, which leaves p dangling (UB)"
   ],
   "answer": 3,
   "explanation": "The capacity is probably 3, so push_back allocates a new buffer and frees the old one. Pointers, references and iterators into the old buffer are invalid.",
   "distractors": "Trivial copyability doesn't stop the buffer moving. Only reserve beforehand would guarantee stability.",
   "source": "lecture",
   "id": "L04-m4"
  },
  {
   "q": "During reallocation, when does `std::vector<T>` move (rather than copy) its elements?",
   "options": [
    "Always",
    "When T's move constructor is noexcept (or T is not copyable)",
    "Never, because it always copies",
    "Only in Release builds"
   ],
   "answer": 1,
   "explanation": "Growth uses std::move_if_noexcept to preserve the strong exception guarantee. A throwing move would leave the old buffer half-moved.",
   "distractors": "This is decided by the type, not the build mode.",
   "source": "lecture",
   "id": "L04-m5"
  },
  {
   "q": "Which statement about `std::deque` is TRUE?",
   "options": [
    "Its elements are stored in one contiguous buffer",
    "push_front is O(n)",
    "push_back keeps references and pointers to existing elements valid, although iterators are invalidated",
    "It doesn't support random access"
   ],
   "answer": 2,
   "explanation": "deque grows by adding blocks, so elements never move. Only the block map is reallocated, which invalidates iterators.",
   "distractors": "It is chunked (not contiguous), push_front is O(1), and it does have O(1) operator[].",
   "source": "lecture",
   "id": "L04-m6"
  },
  {
   "q": "Which operation is O(1) for `std::list` but O(n) for `std::vector`?",
   "options": [
    "Accessing the k-th element",
    "Inserting in the middle given an iterator to the position",
    "Iterating over all elements",
    "push_back"
   ],
   "answer": 1,
   "explanation": "A list just relinks nodes. A vector must shift all later elements.",
   "distractors": "Indexing is O(1) for vector and O(n) for list. Iteration is O(n) for both, and push_back is O(1) (amortised) for both.",
   "source": "lecture",
   "id": "L04-m7"
  },
  {
   "q": "Why is iterating a `std::list<int>` of 1M elements typically much slower than iterating a `std::vector<int>`?",
   "options": [
    "list iterators use virtual calls",
    "list stores elements in reverse",
    "Each node is a separate allocation, so every step is a dependent pointer load that is likely a cache miss, with no prefetching",
    "list must lock a mutex on each access"
   ],
   "answer": 2,
   "explanation": "A vector streams contiguous memory (16 ints per cache line, prefetched). A list hops between scattered nodes at ~60–100 ns per miss.",
   "distractors": "There are no virtual calls or locks, and the order is irrelevant.",
   "source": "lecture",
   "id": "L04-m8"
  },
  {
   "q": "Why does this not compile?\n\n    std::list<int> l{3, 1, 2};\n    std::sort(l.begin(), l.end());",
   "options": [
    "std::sort requires random-access iterators, and list iterators are only bidirectional",
    "list cannot hold ints",
    "sort needs a comparator",
    "list elements are const"
   ],
   "answer": 0,
   "explanation": "std::sort uses it + n and it2 - it1. list provides the member l.sort() (merge sort on nodes) instead.",
   "distractors": "The default comparator is operator<, and list elements are mutable.",
   "source": "lecture",
   "id": "L04-m9"
  },
  {
   "q": "What does this print?\n\n    std::map<std::string, int> m;\n    if (m[\"AAPL\"] == 0) std::cout << m.size();",
   "options": [
    "0",
    "Compile error",
    "Undefined behaviour",
    "1"
   ],
   "answer": 3,
   "explanation": "operator[] inserts a value-initialised entry (0) for a missing key, so the map now has 1 element.",
   "distractors": "This is a classic trap. Use find, contains or at for lookups.",
   "source": "lecture",
   "id": "L04-m10"
  },
  {
   "q": "What is the complexity of `find` in a `std::map` with n elements, and what data structure gives it?",
   "options": [
    "O(log n), red-black tree",
    "O(1) average, hash table",
    "O(n), sorted linked list",
    "O(log n), skip list"
   ],
   "answer": 0,
   "explanation": "std::map is a balanced binary search tree (red-black in all major implementations).",
   "distractors": "Hash tables are unordered_map. Skip lists are not used by the standard library.",
   "source": "lecture",
   "id": "L04-m11"
  },
  {
   "q": "For an order book's bids (highest price first) stored in a std::map, which declaration lets `begin()` return the best bid?",
   "options": [
    "std::map<Price, Level> bids;",
    "std::unordered_map<Price, Level> bids;",
    "std::map<Price, Level, std::less<>> bids;",
    "std::map<Price, Level, std::greater<>> bids;"
   ],
   "answer": 3,
   "explanation": "std::greater orders keys descending, so the highest bid is the leftmost node, reached in O(1) via begin().",
   "distractors": "std::less (the default) puts the lowest price first, which is right for asks. unordered_map has no order.",
   "source": "lecture",
   "id": "L04-m12"
  },
  {
   "q": "Which is TRUE about rehashing in `std::unordered_map`?",
   "options": [
    "It invalidates iterators, but references and pointers to elements stay valid",
    "It invalidates references but not iterators",
    "It never happens if you call reserve() with a smaller value",
    "It is O(1)"
   ],
   "answer": 0,
   "explanation": "Nodes are relinked into the new bucket array but not moved, so element addresses survive. Iterators (which encode bucket position) do not.",
   "distractors": "Rehash is O(n). reserve(n) with n at least the final size prevents it, and a smaller value doesn't help.",
   "source": "lecture",
   "id": "L04-m13"
  },
  {
   "q": "What is the worst-case complexity of `find` in `std::unordered_map`?",
   "options": [
    "O(1)",
    "O(log n)",
    "O(n)",
    "O(n log n)"
   ],
   "answer": 2,
   "explanation": "If many keys land in one bucket (a bad hash or adversarial input), the lookup walks a chain of length O(n).",
   "distractors": "O(1) is the AVERAGE case.",
   "source": "lecture",
   "id": "L04-m14"
  },
  {
   "q": "Which line avoids rehashing while inserting 1M order ids into `std::unordered_map<uint64_t, Order*> m`?",
   "options": [
    "m.rehash(0);",
    "m.max_load_factor(10);",
    "m.reserve(1'000'000);",
    "m.clear();"
   ],
   "answer": 2,
   "explanation": "reserve(n) sizes the bucket array so that n elements fit under the max load factor, so no rehash happens during inserts.",
   "distractors": "A higher load factor reduces rehashes but makes chains longer. rehash(0) and clear() don't pre-size.",
   "source": "lecture",
   "id": "L04-m15"
  },
  {
   "q": "What are the complexities of `top()`, `push()` and `pop()` for `std::priority_queue`?",
   "options": [
    "O(1), O(log n), O(log n)",
    "O(log n), O(1), O(1)",
    "O(1), O(1), O(1)",
    "O(n), O(log n), O(n)"
   ],
   "answer": 0,
   "explanation": "It is a binary heap: the max is at index 0, and push and pop sift up or down along one root-to-leaf path.",
   "distractors": "Only top is constant. Sifting takes log n swaps.",
   "source": "lecture",
   "id": "L04-m16"
  },
  {
   "q": "Why do order-book designs that use `std::priority_queue` need lazy deletion for cancels?",
   "options": [
    "priority_queue sorts in O(n²)",
    "priority_queue cannot remove an arbitrary element, only the top",
    "priority_queue is not thread-safe",
    "priority_queue invalidates references on push"
   ],
   "answer": 1,
   "explanation": "There is no erase(iterator) and no access to interior elements. A cancel marks the order as dead, and it is skipped when it surfaces at the top.",
   "distractors": "Thread safety and reference invalidation aren't the reason. It has no iterators at all.",
   "source": "lecture",
   "id": "L04-m17"
  },
  {
   "q": "What does this leave in v?\n\n    std::vector<int> v{1, -2, 3, -4, 5};\n    std::remove_if(v.begin(), v.end(), [](int x){ return x < 0; });\n    std::cout << v.size();",
   "options": [
    "It prints 5: remove_if only moves the kept elements forward, nothing is erased",
    "It prints 3",
    "It prints 2",
    "Compile error"
   ],
   "answer": 0,
   "explanation": "remove_if returns the new logical end, and the size is unchanged until you call v.erase(newEnd, v.end()) (or use C++20 std::erase_if).",
   "distractors": "Algorithms can't change a container's size, because they only see iterators.",
   "source": "lecture",
   "id": "L04-m18"
  },
  {
   "q": "Which correctly erases zero-quantity levels from `std::map<int,int> m` while iterating?",
   "options": [
    "for (auto& [k, q] : m) if (q == 0) m.erase(k);",
    "for (auto it = m.begin(); it != m.end(); ++it) if (it->second == 0) m.erase(it);",
    "std::sort(m.begin(), m.end()); m.clear();",
    "for (auto it = m.begin(); it != m.end(); ) { if (it->second == 0) it = m.erase(it); else ++it; }"
   ],
   "answer": 3,
   "explanation": "erase invalidates the erased iterator, so you continue from the iterator it returns.",
   "distractors": "The first two increment or continue from an invalidated iterator (UB). You cannot sort a map.",
   "source": "lecture",
   "id": "L04-m19"
  },
  {
   "q": "Which algorithm finds the median of an unsorted vector in average O(n)?",
   "options": [
    "std::sort then index n/2",
    "std::nth_element(v.begin(), v.begin() + n/2, v.end())",
    "std::partial_sort over the whole range",
    "std::binary_search"
   ],
   "answer": 1,
   "explanation": "nth_element (introselect) places the n/2-th element in its sorted position, partitions around it, and runs in average linear time.",
   "distractors": "Sorting is O(n log n), and binary_search needs a sorted range and only tests membership.",
   "source": "lecture",
   "id": "L04-m20"
  },
  {
   "q": "Which is the best structure for price levels when prices are integer ticks in a narrow, known band (e.g. ±5000 ticks around a reference)?",
   "options": [
    "A plain array (or std::array/vector) indexed by (price - base) / tick",
    "std::list of levels",
    "std::unordered_map<Price, Level> with default hashing",
    "std::map<std::string, Level>"
   ],
   "answer": 0,
   "explanation": "Dense integer keys map directly to array slots: O(1) access, no hashing, no nodes, and contiguous memory.",
   "distractors": "Hashing and trees add indirection and allocation, and a list needs a linear search.",
   "source": "lecture",
   "id": "L04-m21"
  },
  {
   "q": "Why can `std::array<int, 8>` sum faster than a `std::vector<int>` of size 8 in a hot function?",
   "options": [
    "array uses SIMD and vector cannot",
    "vector bounds-checks operator[]",
    "array's size is a compile-time constant and its storage is inline, so the loop can be fully unrolled with no heap indirection",
    "array elements are stored in registers permanently"
   ],
   "answer": 2,
   "explanation": "A known trip count allows full unrolling and constant folding, and there is no data pointer to load or heap allocation to make.",
   "distractors": "Both can be vectorised, operator[] is unchecked in both, and permanent register storage isn't a thing.",
   "source": "lecture",
   "id": "L04-m22"
  },
  {
   "q": "What is the cost of `for (auto x : orders)` when `orders` is a `std::vector<Order>` of large structs?",
   "options": [
    "Nothing, because auto deduces a reference",
    "It copies each Order into x; use const auto& to avoid the copies",
    "It moves from each Order, emptying the vector",
    "Compile error"
   ],
   "answer": 1,
   "explanation": "Plain auto deduces Order by value, so each iteration copy-constructs. `const auto&` binds directly to each element.",
   "distractors": "auto never deduces a reference by itself, and range-for never moves from elements.",
   "source": "lecture",
   "id": "L04-m23"
  }
 ],
 "msqs": [
  {
   "q": "Which operations can invalidate ALL iterators to a `std::vector`? (select all that apply)",
   "options": [
    "push_back when size() == capacity()",
    "reserve(n) with n > capacity()",
    "operator[] read",
    "shrink_to_fit() that actually reallocates",
    "pop_back()"
   ],
   "answers": [
    0,
    1,
    3
   ],
   "explanation": "Anything that reallocates the buffer invalidates everything: growth on push_back, reserve beyond capacity, and shrink_to_fit. Reading with [] changes nothing, and pop_back invalidates only the last element and end().",
   "id": "L04-x1"
  },
  {
   "q": "For which containers does `push_back` keep existing REFERENCES to elements valid? (select all that apply)",
   "options": [
    "std::vector (without reserve)",
    "std::deque",
    "std::list",
    "std::vector after reserve(n) while size stays <= n",
    "std::string beyond capacity"
   ],
   "answers": [
    1,
    2,
    3
   ],
   "explanation": "deque adds blocks without moving elements, list links a new node, and a vector with enough reserved capacity doesn't reallocate. Without spare capacity, vector and string reallocate and move everything.",
   "id": "L04-x2"
  },
  {
   "q": "Which containers store their elements contiguously in memory? (select all that apply)",
   "options": [
    "std::vector",
    "std::array",
    "std::deque",
    "std::unordered_map",
    "std::list"
   ],
   "answers": [
    0,
    1
   ],
   "explanation": "vector and array are contiguous (C++20 contiguous iterators). deque is a sequence of separate blocks, unordered_map is a bucket array of separately allocated nodes, and list is separate nodes.",
   "id": "L04-x3"
  },
  {
   "q": "Which statements about `std::map` are true? (select all that apply)",
   "options": [
    "It is typically a red-black tree",
    "Iteration visits keys in sorted order",
    "Inserting an element invalidates all iterators",
    "operator[] inserts a default value for a missing key",
    "Lookup is O(1) on average"
   ],
   "answers": [
    0,
    1,
    3
   ],
   "explanation": "map is a balanced tree with sorted iteration, and operator[] inserts. Inserts never invalidate other iterators, and lookup is O(log n), not O(1).",
   "id": "L04-x4"
  },
  {
   "q": "Which statements about `std::unordered_map` (libstdc++) are true? (select all that apply)",
   "options": [
    "Average-case find is O(1)",
    "Worst-case find is O(n)",
    "Each element is a separately allocated node",
    "Iteration order is sorted by key",
    "reserve() can prevent rehashing during inserts"
   ],
   "answers": [
    0,
    1,
    2,
    4
   ],
   "explanation": "It is a chained hash table with node allocation, average O(1) and worst O(n), and pre-sizing avoids rehash. Iteration order is unspecified, not sorted.",
   "id": "L04-x5"
  },
  {
   "q": "Which algorithms REQUIRE a sorted range (by the same comparator) to give meaningful results? (select all that apply)",
   "options": [
    "std::lower_bound",
    "std::binary_search",
    "std::find",
    "std::unique (to remove ALL duplicates)",
    "std::accumulate"
   ],
   "answers": [
    0,
    1,
    3
   ],
   "explanation": "Binary searches need sorted input, and unique only removes ADJACENT duplicates, so you must sort first to dedupe fully. find is a linear scan, and accumulate doesn't care about order.",
   "id": "L04-x6"
  },
  {
   "q": "Which iterator categories do these containers provide? Select the correct pairings. (select all that apply)",
   "options": [
    "std::list: bidirectional",
    "std::vector: contiguous (random access)",
    "std::map: random access",
    "std::forward_list: bidirectional",
    "std::deque: contiguous"
   ],
   "answers": [
    0,
    1
   ],
   "explanation": "list is bidirectional and vector is contiguous. map is only bidirectional (not random access), forward_list is forward-only (singly linked, no --), and deque is random access but not contiguous.",
   "id": "L04-x7"
  },
  {
   "q": "Which are good reasons to choose `std::list` over `std::vector`? (select all that apply)",
   "options": [
    "You need iterators and references that stay valid while inserting and erasing elsewhere",
    "You need O(1) splicing of elements between lists",
    "You need fast random access by index",
    "You frequently erase at positions you already hold iterators to",
    "You want the best iteration speed"
   ],
   "answers": [
    0,
    1,
    3
   ],
   "explanation": "Stability, splice and O(1) erase at a known position are list's real advantages. Random access and iteration speed are exactly where it loses badly to vector.",
   "id": "L04-x8"
  },
  {
   "q": "Which statements about `std::priority_queue<int>` are true? (select all that apply)",
   "options": [
    "By default top() returns the largest element",
    "pop() returns the removed element",
    "It is implemented as a binary heap on a std::vector by default",
    "You can erase an arbitrary element in O(log n) with the standard interface",
    "std::greater<int> as the comparator gives a min-heap"
   ],
   "answers": [
    0,
    2,
    4
   ],
   "explanation": "The default is a max-heap on a vector, and greater makes it a min-heap. pop() returns void, and there is no arbitrary erase, hence lazy deletion in order books.",
   "id": "L04-x9"
  },
  {
   "q": "Which of these are undefined behaviour? (select all that apply)",
   "options": [
    "std::vector<int> v; v.reserve(10); v[3] = 1;",
    "std::vector<int> v(10); v.at(20);",
    "*v.end() for a non-empty vector",
    "Erasing from a std::map inside a range-for over that map, then continuing the loop",
    "std::map<int,int> m; m[5];"
   ],
   "answers": [
    0,
    2,
    3
   ],
   "explanation": "Writing past size() after reserve, dereferencing end(), and continuing with an invalidated iterator are UB. at(20) throws std::out_of_range (defined), and m[5] just inserts 0.",
   "id": "L04-x10"
  },
  {
   "q": "Which practices reduce latency when using STL containers on a hot path? (select all that apply)",
   "options": [
    "Calling reserve() at start-up for vectors and unordered_maps",
    "Using emplace_back to construct in place",
    "Using std::map for a 16-element lookup table instead of a linear scan of an array",
    "Iterating with const auto& rather than auto for large elements",
    "Using std::endl to flush after each log line"
   ],
   "answers": [
    0,
    1,
    3
   ],
   "explanation": "Pre-sizing, in-place construction and avoiding copies all help. A tiny map is slower than scanning one or two cache lines, and endl forces a flush (syscall) per line.",
   "id": "L04-x11"
  },
  {
   "q": "Which statements comparing `std::vector` and `std::array` are true? (select all that apply)",
   "options": [
    "std::array's size is part of its type and fixed at compile time",
    "std::vector always stores its elements on the heap",
    "std::array decays to a pointer when passed to a function",
    "std::array can live on the stack with no allocation",
    "std::vector can grow at run time"
   ],
   "answers": [
    0,
    1,
    3,
    4
   ],
   "explanation": "array is a fixed-size inline aggregate that never decays (that is a C-array behaviour). A vector's buffer is heap-allocated (with the default allocator) and resizable.",
   "id": "L04-x12"
  },
  {
   "q": "Which statements about `std::sort` and related algorithms are true? (select all that apply)",
   "options": [
    "std::sort guarantees O(n log n) worst case (C++11 onward)",
    "std::sort is stable",
    "std::stable_sort preserves the relative order of equal elements",
    "std::partial_sort of the top k is O(n log k)",
    "std::sort works on std::list iterators"
   ],
   "answers": [
    0,
    2,
    3
   ],
   "explanation": "Introsort guarantees O(n log n), stable_sort preserves ties (useful for time priority), and partial_sort is O(n log k). sort is not stable and needs random-access iterators.",
   "id": "L04-x13"
  },
  {
   "q": "Which statements about `std::vector<bool>` are true? (select all that apply)",
   "options": [
    "It packs elements as bits",
    "operator[] returns a proxy object rather than bool&",
    "`bool& b = v[0];` compiles",
    "Writing different elements from different threads can race, because they share bytes",
    "It is guaranteed to be faster than vector<char> for every workload"
   ],
   "answers": [
    0,
    1,
    3
   ],
   "explanation": "It is a space-optimised bitset specialisation with a proxy reference. Binding a bool& fails, and adjacent bits share a byte, so concurrent writes race. Bit manipulation often makes it slower than vector<char>.",
   "id": "L04-x14"
  }
 ],
 "short": [
  {
   "q": "Explain how `std::vector` grows when you push_back past its capacity, why push_back is amortised O(1), and why low-latency code calls reserve().",
   "checks": [
    {
     "label": "Allocates a bigger buffer (geometric growth, 2x)",
     "patterns": [
      "2x|double|1\\.5|geometric|growth factor"
     ]
    },
    {
     "label": "Moves/copies elements and frees old buffer",
     "patterns": [
      "(mov|cop)(e|y|ies|ing).*elements|old buffer"
     ]
    },
    {
     "label": "Explains amortised argument",
     "patterns": [
      "amorti[sz]"
     ]
    },
    {
     "label": "Mentions invalidation of iterators / pointers",
     "patterns": [
      "invalidat"
     ]
    },
    {
     "label": "reserve avoids reallocations / latency spikes",
     "patterns": [
      "reserve.*(avoid|prevent|no |once)|latency spike|spike"
     ]
    }
   ],
   "modelAnswer": "When `size() == capacity()`, `push_back` allocates a **new buffer a constant factor larger** (libstdc++ doubles it, 2×; MSVC uses 1.5×), **moves the elements** into it (copying them if the move constructor isn't `noexcept`), destroys them in the **old buffer**, frees it, and then appends.\n\n**Amortised O(1):** with geometric growth, the total number of element moves over n pushes is at most n + n/2 + n/4 + … < 2n, so the average cost per push is constant even though the one push that reallocates costs O(n).\n\n**Why reserve:** each reallocation is a latency spike (an allocation that may make a syscall or page fault, O(n) copying, a free) and it **invalidates** all iterators, pointers and references into the vector. In a trading system you call `reserve(expected_max)` at start-up, so the buffer is allocated once and reallocation never happens on the hot path.",
   "explanation": "The examiner wants the mechanism, the amortised argument and the latency and invalidation reasons for reserve.",
   "id": "L04-s1"
  },
  {
   "q": "Compare std::vector, std::list and std::deque: memory layout, complexity of common operations, iterator invalidation, and when you would pick each.",
   "checks": [
    {
     "label": "vector contiguous",
     "patterns": [
      "contiguous"
     ]
    },
    {
     "label": "list node per element / pointers",
     "patterns": [
      "node"
     ]
    },
    {
     "label": "deque blocks / chunks",
     "patterns": [
      "block|chunk"
     ]
    },
    {
     "label": "Cache argument",
     "patterns": [
      "cache"
     ]
    },
    {
     "label": "Invalidation discussed",
     "patterns": [
      "invalidat"
     ]
    }
   ],
   "modelAnswer": "| | vector | list | deque |\n|---|---|---|---|\n| Layout | one **contiguous** heap buffer | a separate **node** per element (prev/next pointers) | fixed-size **blocks** plus a map of block pointers |\n| Index access | O(1) | O(n) | O(1) (two hops) |\n| push/pop back | amortised O(1) | O(1) | O(1) |\n| push/pop front | O(n) | O(1) | O(1) |\n| Middle insert/erase | O(n) shift (memmove) | O(1) given an iterator | O(n) |\n| Invalidation | reallocation **invalidates all**; otherwise at or after the point | only the erased element | end pushes invalidate iterators but keep references valid; middle ops invalidate all |\n\n**Cache:** vector is the most **cache**-friendly (sequential, prefetched). deque is nearly as good within a block. list causes a likely cache miss per node and allocates on every insert.\n\n**Pick:** vector by default; deque for a growing FIFO or when you need pushes at both ends or stable references while appending; list only when you need stable iterators, O(1) splice, or O(1) erase at held iterators (in HFT usually an intrusive list over a pool).",
   "explanation": "The examiner wants the three layouts, the complexities and the invalidation rules, plus a cache-aware recommendation.",
   "id": "L04-s2"
  },
  {
   "q": "Find the bug and fix it:\n\n    std::vector<int> v{1, 2, 3, 4, 5, 6};\n    for (auto it = v.begin(); it != v.end(); ++it)\n        if (*it % 2 == 0) v.erase(it);",
   "checks": [
    {
     "label": "Says erase invalidates the iterator",
     "patterns": [
      "invalidat"
     ]
    },
    {
     "label": "Calls it UB",
     "patterns": [
      "undefined|\\bub\\b"
     ]
    },
    {
     "label": "Uses it = v.erase(it)",
     "patterns": [
      "it\\s*=\\s*v\\.erase\\(\\s*it\\s*\\)"
     ]
    },
    {
     "label": "Mentions erase-remove or std::erase_if",
     "patterns": [
      "remove_if|erase_if"
     ]
    }
   ],
   "modelAnswer": "`v.erase(it)` **invalidates** `it` (and every iterator after it). The loop then does `++it` on an invalid iterator, which is **undefined behaviour**. It can skip elements, run past `end()` or crash.\n\nFix 1, continue from the iterator `erase` returns:\n\n```cpp\nfor (auto it = v.begin(); it != v.end(); )\n    if (*it % 2 == 0) it = v.erase(it);\n    else ++it;\n```\n\nThis is correct but O(n²) for a vector, because each erase shifts the tail. Fix 2 is the better choice: the erase-remove idiom (one O(n) pass), or C++20 `std::erase_if`:\n\n```cpp\nv.erase(std::remove_if(v.begin(), v.end(), [](int x){ return x % 2 == 0; }), v.end());\nstd::erase_if(v, [](int x){ return x % 2 == 0; });   // C++20\n```",
   "explanation": "This tests iterator invalidation on erase and the idiomatic O(n) fix.",
   "id": "L04-s3"
  },
  {
   "q": "You need to store resting orders so that you can (a) look up any order by its 64-bit id to cancel it, and (b) find the best bid and ask price quickly. Which STL containers would you use, with what complexities, and what would you change for production low latency?",
   "checks": [
    {
     "label": "unordered_map for id lookup",
     "patterns": [
      "unordered_map"
     ]
    },
    {
     "label": "map (ordered) for price levels, greater for bids",
     "patterns": [
      "std::map|map<|greater"
     ]
    },
    {
     "label": "Gives O(1) avg and O(log n)",
     "patterns": [
      "O\\(1\\)"
     ]
    },
    {
     "label": "Mentions reserve / pre-allocation",
     "patterns": [
      "reserve|pre-?allocat|pool"
     ]
    },
    {
     "label": "Production alternative: array indexed by tick / flat / intrusive list",
     "patterns": [
      "array indexed|indexed by (price|tick)|flat|intrusive|sorted vector"
     ]
    }
   ],
   "modelAnswer": "- **(a) Order id to order:** `std::unordered_map<uint64_t, Order*>` (or an iterator or handle into the level's queue). Average **O(1)** find and erase for cancel and modify. Call `reserve(max_orders)` at start-up so it never rehashes during trading.\n- **(b) Price levels:** two ordered maps, `std::map<Price, Level, std::greater<>> bids` and `std::map<Price, Level> asks`. The best price is `begin()` in O(1). Inserting or removing a level is O(log n). Each `Level` holds a FIFO (`std::list` or `deque`) of orders for price-time priority. A `std::list` lets the id map store an iterator, so cancel is an O(1) erase.\n\n**Production changes for low latency:**\n\n- Replace the trees with an **array indexed by price tick** (`(price - base)/tick`) for a dense band, or a **flat sorted vector** of levels where most activity is near the top. That gives O(1) or near-O(1) access with contiguous memory and no node allocations.\n- Use an **intrusive** doubly linked list of orders inside each level, with nodes from a **pre-allocated pool**.\n- Use a flat open-addressing hash map for id lookup, pre-sized.\n- Allocate everything up front so nothing touches `malloc` on the hot path.",
   "explanation": "The examiner wants the right container per access pattern with complexities, plus awareness of cache-friendly production alternatives.",
   "id": "L04-s4"
  },
  {
   "q": "Explain iterator categories in the STL and why `std::sort` cannot be used on a `std::list`. Also explain why `std::lower_bound(m.begin(), m.end(), k)` on a std::map is a bad idea.",
   "checks": [
    {
     "label": "Lists categories incl. bidirectional and random access",
     "patterns": [
      "bidirectional"
     ]
    },
    {
     "label": "Mentions random access",
     "patterns": [
      "random[- ]access"
     ]
    },
    {
     "label": "sort needs random access / list::sort member",
     "patterns": [
      "l(ist)?\\.sort\\(|member sort|list::sort"
     ]
    },
    {
     "label": "map lower_bound member is O(log n) vs O(n) steps",
     "patterns": [
      "O\\(n\\)"
     ]
    },
    {
     "label": "Recommends m.lower_bound",
     "patterns": [
      "m\\.lower_bound|member lower_bound|map::lower_bound"
     ]
    }
   ],
   "modelAnswer": "Categories, from weakest to strongest: **input/output** (single pass), **forward** (multi-pass, `++`: `forward_list`, `unordered_*`), **bidirectional** (`++`/`--`: `list`, `map`, `set`), **random access** (`it + n`, `it2 - it1`, `<` in O(1): `deque`), and **contiguous** (C++20: random access plus adjacent in memory: `vector`, `array`, `string`). Algorithms state the minimum category they need.\n\n`std::sort` (introsort) needs **random-access** iterators to jump to pivots and compute distances in O(1). `std::list` only has bidirectional iterators, so the call does not compile. Use the member **`l.sort()`**, a merge sort that relinks nodes without moving elements.\n\n`std::lower_bound` *does* compile with bidirectional iterators, but each \"jump to the middle\" is done with `std::advance` step by step, so it does O(log n) comparisons but **O(n) iterator increments**. The member **`m.lower_bound(k)`** walks the tree directly in O(log n). Always prefer the member functions of associative containers (`find`, `lower_bound`, `count`) over the generic algorithms.",
   "explanation": "The examiner wants the category hierarchy and the two practical consequences.",
   "id": "L04-s5"
  },
  {
   "q": "Compare `std::vector<T>` with a static array (`std::array<T, N>` or `T[N]`) from a performance point of view. When would you use each in a trading system?",
   "checks": [
    {
     "label": "vector on heap / allocation",
     "patterns": [
      "heap|allocat"
     ]
    },
    {
     "label": "array inline / stack / no allocation",
     "patterns": [
      "stack|inline|no allocation"
     ]
    },
    {
     "label": "Compile-time size enables unrolling / optimisation",
     "patterns": [
      "compile[- ]time|unroll"
     ]
    },
    {
     "label": "Indirection through data pointer",
     "patterns": [
      "indirection|data pointer|pointer (load|chase)"
     ]
    },
    {
     "label": "Vector can grow / runtime size + reserve",
     "patterns": [
      "run[- ]?time|grow|reserve"
     ]
    }
   ],
   "modelAnswer": "- **Storage:** a `std::vector` keeps its elements on the **heap** (an allocation at construction or growth), and the object itself is just three pointers. A `std::array`/`T[N]` stores its elements **inline**: on the stack, in static storage or embedded inside another struct, with **no allocation**.\n- **Access:** a vector element access first loads the **data pointer** (one extra **indirection**, usually hoisted out of loops), and the elements may sit in a different cache line from the owning object. Array elements are at a fixed offset from `rsp`, a global or `this`.\n- **Optimisation:** an array's size is a **compile-time** constant, so the compiler can fully **unroll** small loops, constant-fold and keep small arrays in registers. A vector's size is known only at run time.\n- **Flexibility:** a vector has a **run-time** size and can **grow** (with reallocation spikes unless you **reserve**). An array is fixed.\n\nIn a trading system: use `std::array` for fixed-capacity hot structures (an SPSC ring buffer of 1024 slots, top-N book levels, per-symbol tables, lookup tables). Use `std::vector` when the size is only known at start-up (number of instruments, a pool sized from config), call `reserve` once, and never let it grow on the hot path.",
   "explanation": "The examiner wants heap vs inline, indirection, compile-time size and the practical rule of thumb.",
   "id": "L04-s6"
  }
 ],
 "quiz": [],
 "coding": [
  {
   "id": "inplace-vector",
   "title": "Fixed-Capacity In-Place Vector"
  },
  {
   "id": "fixed-lru-cache",
   "title": "Allocation-Free LRU Cache"
  }
 ],
 "prev": {
  "num": 3,
  "file": "lecture-03.html"
 },
 "next": {
  "num": 5,
  "file": "lecture-05.html"
 }
};
