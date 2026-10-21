window.PAGE = {
 "num": 14,
 "title": "Capstone: Low-Latency Order Book",
 "summary": "Building the course's capstone: a price-time priority limit order book in the style of David Gross's CppCon 2024 talk 'When Nanoseconds Matter'. It covers turning the class design notes into a correct spec, moving from a std::map baseline to best-at-back level vectors with linear or branchless search, pooled orders in intrusive FIFOs with an id index, a tested implementation, and how to measure, test and embed the book in a low-latency system.",
 "notes": [
  {
   "heading": "The capstone brief",
   "body": "Build a **low-latency limit order book** for one instrument, in the spirit of David Gross's (Optiver) CppCon 2024 talk *When Nanoseconds Matter: Ultrafast Trading Systems in C++*, plus the requirements written in class (`Capstone/capstone.txt`).\n\n**In class** the requirements were:\n\n1. The order book has to support **price-time priority**.\n2. An `Order { id, side, price, qty, timestampNs }`.\n3. Bids = how much someone is willing to buy at; asks = how much someone is willing to sell at.\n4. **Support 1000 price levels.**\n5. **Matching** of crossing orders (worked through with Kartik, Manik and Paras on RELIANCE).\n6. The interface:\n\n```cpp\nclass OrderBook {\n    addOrder(Order o);\n    removeOrder(int id);\n    getBids();\n    getAsks();\n    BBO getBBO();          // top_most_bid, top_most_ask\n};\n```\n\n7. Candidate designs: priority_queue + lazy deletion (\"TC SC not known\"), multiset (delete in the middle), `std::map<Price, vector<Order>>`.\n\nWhat \"low latency\" means here: every operation (add, cancel, execute, BBO query) should take tens of nanoseconds with a tight **tail** (p99/p99.9), with **no heap allocation, no syscalls and no locks** on the hot path."
  },
  {
   "heading": "Turning the class notes into a correct spec",
   "body": "Things to fix before writing code:\n\n| Class note | Problem | Fix |\n|---|---|---|\n| `uint id; uint timestampNs;` | 32-bit ns timestamp wraps in ~4.3 s; 32-bit id can wrap on a busy day | `uint64_t` id and timestamp (or a sequence number) |\n| `Price price` (e.g. 10.5, 100.5) | Doubles are inexact keys | Integer ticks: with tick 0.5, 100.5 becomes 201 |\n| `map<PRICE, vector<Order>> bids`, `map<..., greater<>> asks` | Comparators swapped: `begin()` gives the worst price on both sides | bids `std::greater`, asks `std::less` (or best-at-back vectors) |\n| `vector<Order>` FIFO | Popping the front is O(n) | Intrusive list / deque / head index |\n| `map<int,int> DELETE; DELETE[6]++` (lazy deletion) | O(log n) per mark, unbounded growth | `unordered_set` or a flag in the pooled order; or a design with real O(1) cancel |\n| `removeOrder(int id)` | Needs to find the order without a scan | Hash map / array from id to the order |\n\nAlso decide the **events** the book emits: trades (aggressor id, passive id, price, qty), order acks, and BBO/level updates for strategies."
  },
  {
   "heading": "Baseline first: std::map, then measure",
   "body": "Gross's method (and the course's): write the obvious correct version, build a benchmark that replays **realistic** data, measure, and only then optimise.\n\n```cpp\nstd::map<Price, Level, std::greater<Price>> bids;   // best = begin()\nstd::map<Price, Level>                      asks;\nstd::unordered_map<Id, Location> index;            // id -> (side, price, list iterator)\n```\n\nWhy it is slow on real data:\n\n- Every new price level is a heap allocation (malloc ~20-100 ns) and every lookup walks ~log2(L) red-black-tree nodes scattered in memory (pointer chasing, cache misses).\n- Most order-book updates happen **within a few levels of the top of book**, but a tree treats every price the same.\n\nMeasure with a latency **distribution** per operation, not only throughput:\n\n```cpp\n#include <x86intrin.h>\nstd::vector<std::uint64_t> lat; lat.reserve(N);\nfor (auto& m : msgs) {\n    auto t0 = __rdtsc();\n    book.apply(m);\n    lat.push_back(__rdtsc() - t0);             // cycles; divide by TSC GHz for ns\n}\nstd::sort(lat.begin(), lat.end());\nauto pct = [&](double p) { return lat[std::size_t(p * (lat.size() - 1))]; };\nstd::printf(\"p50 %llu p99 %llu p99.9 %llu max %llu\\n\",\n    (unsigned long long)pct(.5), (unsigned long long)pct(.99), (unsigned long long)pct(.999), (unsigned long long)lat.back());\n```"
  },
  {
   "heading": "The key idea from the talk: vectors with the best price at the back",
   "body": "The main data-structure lesson in Gross's talk (paraphrased): replace the tree with a **contiguous `std::vector` of levels**, sorted so that the **best price is at the end**.\n\n- Insert/erase in a vector shifts every element after the position. If the best price were at the front, a new best level (very common) would shift the whole vector. With the best at the **back**, an operation near the top shifts only the few levels above it.\n- The levels are contiguous: several fit per cache line and the prefetcher streams them.\n- No allocation after `reserve`.\n\nHow to find a level:\n\n1. `std::lower_bound` (binary search): O(log L), but its branches are unpredictable (each comparison is ~50/50) so it mispredicts several times per search.\n2. **Linear search from the back**: O(d) where d = distance from the top. Since most updates are near the top, d is tiny (1-3 levels), the branches are predictable and the data is in one or two cache lines. On real distributions this **beat binary search** in the talk.\n3. **Branchless binary search**: binary search where the \"go left or right\" decision is a conditional move, so there is nothing to mispredict. Useful when updates are spread deeper in the book.\n\n```cpp\nstd::size_t branchless_lower_bound(const Price* a, std::size_t n, Price key) {\n    if (n == 0) return 0;\n    const Price* base = a;\n    while (n > 1) {\n        std::size_t half = n / 2;\n        base = (base[half] < key) ? base + half : base;   // compiles to cmov\n        n -= half;\n    }\n    return static_cast<std::size_t>(base - a) + (*base < key);   // same result as std::lower_bound\n}\n```\n\nThe general principle: **look at your data distribution and exploit it**. Asymptotic complexity is a starting point; cache behaviour and branch predictability decide real latency."
  },
  {
   "heading": "Orders, cancels and memory: pool + intrusive FIFO + id index",
   "body": "Levels hold aggregate quantity for market-by-price consumers and, for price-time priority, a FIFO of individual orders.\n\n- **Order pool**: allocate all `Order` objects at startup (`std::vector<Order> pool(max_orders)` plus a free list of pointers). Add = pop a free slot, cancel/fill = push it back. O(1), no malloc, no fragmentation, good locality. (**In class**, the Lec-9 homework introduced exactly this: allocate a huge chunk at startup and create objects on it.)\n- **Intrusive doubly linked FIFO**: each `Order` has `prev`/`next`; the `Level` has `head`/`tail`. Append at the tail, fill from the head, cancel unlinks in O(1).\n- **Id index**: `unordered_map<Id, Order*>` with `reserve()` (no rehash on the hot path), or better a flat open-addressing table, or a direct array when exchange ids are dense.\n- Pointers from the id index point into the **pool**, which never moves, so they stay valid even though the level vector reallocates/shifts. Orders do not point to their `Level` (levels move inside the vector); a cancel finds the level by price with the same near-top linear search.\n- Fixed capacity also means **predictable** worst-case latency; on pool exhaustion reject, do not allocate."
  },
  {
   "heading": "A capstone implementation (compiled and tested)",
   "body": "This version implements the design above. It was compiled with `g++ -std=c++17 -O2 -Wall` and reproduces the class example (prices in ticks of 0.5: 100 = 200, 100.5 = 201, 101 = 202): Paras's SELL 10 @ 200 trades 5 @ 201 then 5 @ 200, leaving BBO 200 x 5 | 202 x 5.\n\n```cpp\nusing Price = std::int64_t; using Qty = std::int64_t; using Id = std::uint64_t;\nenum class Side : std::uint8_t { Buy, Sell };\n\nstruct Order {                    // lives in a pre-allocated pool\n    Id id; Price price; Qty qty; Side side;\n    Order* prev; Order* next;      // intrusive FIFO inside its level\n};\nstruct Level { Price price; Qty total; Order* head; Order* tail; };\n\ntemplate <bool IsBid>\nstruct BookSide {\n    std::vector<Level> lv;         // sorted worst -> best: best price at the BACK\n    BookSide() { lv.reserve(4096); }\n    static bool better(Price a, Price b) { return IsBid ? a > b : a < b; }\n\n    // Linear search from the top of book. Returns i such that\n    // lv[i-1].price == p (level exists) or i is the insertion point.\n    std::size_t find(Price p) const {\n        std::size_t i = lv.size();\n        while (i > 0 && better(lv[i - 1].price, p)) --i;\n        return i;\n    }\n    Level& get_or_add(Price p) {\n        std::size_t i = find(p);\n        if (i > 0 && lv[i - 1].price == p) return lv[i - 1];\n        return *lv.insert(lv.begin() + i, Level{p, 0, nullptr, nullptr});   // near the back: few moves\n    }\n    bool empty() const { return lv.empty(); }\n    Level& best() { return lv.back(); }\n};\n\nclass OrderBook {\n    BookSide<true>  bids;\n    BookSide<false> asks;\n    std::vector<Order> pool;  std::vector<Order*> free_;\n    std::unordered_map<Id, Order*> index;\n\n    Order* alloc() { Order* o = free_.back(); free_.pop_back(); return o; }\n    void release(Order* o) { index.erase(o->id); free_.push_back(o); }\n\n    static void push_back(Level& L, Order* o) {\n        o->prev = L.tail; o->next = nullptr;\n        if (L.tail) L.tail->next = o; else L.head = o;\n        L.tail = o; L.total += o->qty;\n    }\n    static void unlink(Level& L, Order* o) {\n        (o->prev ? o->prev->next : L.head) = o->next;\n        (o->next ? o->next->prev : L.tail) = o->prev;\n        L.total -= o->qty;\n    }\n    template <class Opp, class Crosses>\n    void match(Order& in, Opp& opp, Crosses crosses) {\n        while (in.qty > 0 && !opp.empty() && crosses(opp.best().price)) {\n            Level& L = opp.best();\n            Order* r = L.head;\n            Qty q = std::min(in.qty, r->qty);\n            std::printf(\"TRADE %llu x %llu: %lld @ %lld\\n\", (unsigned long long)in.id,\n                        (unsigned long long)r->id, (long long)q, (long long)L.price);\n            in.qty -= q; r->qty -= q; L.total -= q;\n            if (r->qty == 0) { L.head = r->next; if (L.head) L.head->prev = nullptr; else L.tail = nullptr; release(r); }\n            if (!L.head) opp.lv.pop_back();              // best level emptied: O(1)\n        }\n    }\npublic:\n    explicit OrderBook(std::size_t max_orders) : pool(max_orders) {\n        free_.reserve(max_orders);\n        for (auto& o : pool) free_.push_back(&o);\n        index.reserve(max_orders);\n    }\n    void addOrder(Id id, Side s, Price px, Qty qty) {\n        Order in{id, px, qty, s, nullptr, nullptr};\n        if (s == Side::Buy) match(in, asks, [&](Price p) { return p <= px; });\n        else                match(in, bids, [&](Price p) { return p >= px; });\n        if (in.qty == 0) return;\n        Order* o = alloc(); *o = in; index[id] = o;\n        if (s == Side::Buy) push_back(bids.get_or_add(px), o);\n        else                push_back(asks.get_or_add(px), o);\n    }\n    void removeOrder(Id id) {\n        auto it = index.find(id); if (it == index.end()) return;\n        Order* o = it->second;\n        auto cancel = [&](auto& side) {\n            std::size_t i = side.find(o->price);           // level is at i-1\n            Level& L = side.lv[i - 1];\n            unlink(L, o);\n            if (!L.head) side.lv.erase(side.lv.begin() + (i - 1));\n        };\n        if (o->side == Side::Buy) cancel(bids); else cancel(asks);\n        release(o);\n    }\n    void bbo() {\n        std::printf(\"BBO %lld x %lld | %lld x %lld\\n\",\n            bids.empty() ? 0LL : (long long)bids.best().price, bids.empty() ? 0LL : (long long)bids.best().total,\n            asks.empty() ? 0LL : (long long)asks.best().price, asks.empty() ? 0LL : (long long)asks.best().total);\n    }\n};\n```\n\nPoints to explain in a viva:\n\n- `BookSide<IsBid>` is a template so `better()` is resolved at compile time: no virtual calls, no runtime branch on side inside the search.\n- The best level is `lv.back()`; consuming the best level is `pop_back()`, O(1).\n- `find()` scans from the back; for orders near the top it stops after 1-3 comparisons.\n- `printf` in `match()` is only for the demo; a real book writes trade events to an SPSC queue.\n- `std::unordered_map` is the simplest correct id index; a flat hash table or id-indexed array removes its node allocations."
  },
  {
   "heading": "Matching engine logic and events",
   "body": "Algorithm for an incoming limit order (the `match` template above):\n\n1. While the order has quantity left **and** the opposite side's best price crosses (buy: `best_ask <= px`; sell: `best_bid >= px`):\n   - take the **head** (oldest) order of the best level: time priority;\n   - trade `min(in.qty, resting.qty)` at the **resting price**;\n   - decrement both, and the level's aggregate;\n   - if the resting order is filled, unlink it and return it to the pool;\n   - if the level is empty, remove it (`pop_back`), so the next level becomes the best.\n2. If quantity remains, rest it at its price on its own side (append to the tail of that level's FIFO).\n\nVariants:\n\n- **Market order**: same loop with no price check; leftover is cancelled.\n- **IOC**: same loop with the price check; skip step 2.\n- **FOK**: first check that enough quantity exists at crossing prices (walk levels summing totals), then match or reject.\n- **Modify down** in place (keeps priority); **modify up / price change** = cancel + add.\n\nOutput events (trade, order accepted/cancelled, BBO change) go to the downstream strategy or gateway through a lock-free SPSC queue so the book's thread never blocks."
  },
  {
   "heading": "System design around the book",
   "body": "The book is one piece of a trading pipeline: market data in, book update, strategy decision, order out.\n\n- **One thread owns one book** (or a set of instruments). No locks: inputs arrive via an **SPSC queue** from the network thread, outputs leave via another. **In class** (Lec-10/11/12) we built exactly this queue: power-of-two ring, `head_`/`tail_` atomics with acquire/release, `alignas(64)` so producer and consumer indices do not falsely share a cache line, benchmarked with `-O3 -march=native` and a global sink.\n- **Pin threads to isolated cores** (`isolcpus`, `taskset`, `pthread_setaffinity_np`) and **busy-poll**: blocking or sleeping costs microseconds to wake up.\n- **No syscalls / allocation / exceptions on the hot path**: pools, pre-reserved vectors, asynchronous logging.\n- **Kernel-bypass networking** (user-space NIC access) avoids socket syscalls and interrupts; the talk also discusses passing data between processes through **shared memory** queues.\n- **Warm-up**: run the hot path with dummy data so code, data and branch predictors stay warm when real signals are rare.\n- **Huge pages and pre-faulting** for large pools so no page faults happen while trading.\n- **Measure in production-like conditions** with `perf stat` (IPC, cache and branch misses), per-message latency histograms and `perf c2c` for cache-line contention."
  },
  {
   "heading": "Testing for correctness",
   "body": "A fast but wrong book loses money, so test it like a product.\n\n1. **Reference model**: a simple `std::map<Price, std::list<Order>>` book. Feed both the same random stream (adds, cancels, crossing orders), compare trades and the full book after every message (**differential fuzzing**).\n2. **Invariants** checked in debug builds after each operation:\n   - best bid < best ask (the book is never crossed after matching);\n   - each level's `total` equals the sum of its orders' qty;\n   - levels are strictly sorted with the best at the back; no empty levels remain;\n   - every order in the index is in exactly one level, and pool free count + live orders = capacity.\n3. **Scenario tests**: the class example (Kartik/Manik/Paras), FIFO at one price, a sweep through several levels, cancel of the head/middle/tail order, cancel of an unknown id, modify that keeps or loses priority.\n4. **Sanitizers**: build tests with `-fsanitize=address,undefined` to catch use-after-free of pooled orders and UB.\n5. **Benchmarks** in CI to catch latency regressions (p50 and p99, not only mean)."
  },
  {
   "heading": "Design principles to quote in the exam",
   "body": "Paraphrasing the main lessons of the talk and the course:\n\n1. **Measure first**, with realistic data and latency percentiles; profile before optimising.\n2. **Know your data**: most activity is at the top of the book, so optimise that case (best-at-back vector, linear search).\n3. **Contiguous memory beats node-based containers**: vectors and arrays over map/list/set on the hot path.\n4. **Branch predictability matters**: a predictable O(n) scan can beat an unpredictable O(log n) search; branchless code removes mispredictions.\n5. **No allocation, syscalls or locks on the hot path**: pools, pre-allocation, SPSC queues, busy polling.\n6. **Mechanical sympathy**: design around cache lines (64 B), false sharing, the TLB, and the pipeline.\n7. **Simplicity**: the fastest code is the code that does not run; keep the hot path short and specialised (templates instead of virtual calls).\n8. **Correctness first**: a reference implementation and invariants protect every optimisation."
  },
  {
   "heading": "Quick revision",
   "body": "- Requirements: price-time priority, add/cancel/BBO/match, 1000 price levels, low tail latency.\n- Fix the class notes: 64-bit ids/timestamps, integer tick prices, bids descending / asks ascending.\n- Baseline `std::map` is correct but allocates and chases pointers.\n- Gross: `std::vector` of levels, best price at the back, so near-top inserts shift little.\n- Linear search from the back beat binary search on real data (predictable, cache-friendly).\n- Branchless binary search uses cmov to avoid mispredictions.\n- Best level = `back()`, consuming it = `pop_back()` O(1).\n- Orders in a pre-allocated pool with a free list; intrusive prev/next FIFO per level.\n- Id index: hash map (reserved) or flat table from id to `Order*`.\n- Pool pointers stay valid when the level vector moves; orders must not store pointers to levels in a vector.\n- Trades at the resting price; FIFO head first; remove empty levels.\n- One thread per book, SPSC queues in/out, pinned cores, busy-polling.\n- Latency: report p50/p99/p99.9/max using rdtsc or steady_clock.\n- Test against a reference map book with fuzzing and invariants (never crossed, totals match)."
  },
  {
   "heading": "Exam traps",
   "body": "- \"Binary search is always faster than linear search\": not for a handful of near-top levels; branch mispredictions and cache misses dominate.\n- Best-at-the-front vectors make the most common insert (a new best price) O(L).\n- Storing `Level*` in orders breaks when the vector of levels inserts/erases (elements move); store prices or indices recomputed on demand.\n- `std::vector<Order>` as the order store breaks pointers held in the id index when it grows; use a fixed pool that never reallocates.\n- `unordered_map` without `reserve` can rehash on the hot path (a latency spike).\n- Reporting only average latency hides the tail that loses trades.\n- A benchmark with uniformly random prices does not represent market data and can lead to the wrong design.\n- Lazy deletion's O(1) cancel is not free: stale entries cost memory and work later.\n- `getBBO()` must handle an empty side; do not read `back()` of an empty vector (UB).\n- Market orders must not rest; FOK must check available quantity before trading anything."
  }
 ],
 "keyTerms": [
  {
   "term": "When Nanoseconds Matter",
   "def": "David Gross's (Optiver) CppCon 2024 talk on ultrafast trading systems in C++, the model for the capstone."
  },
  {
   "term": "Best-at-back vector",
   "def": "Levels kept in a sorted std::vector with the best price at the end so near-top changes shift few elements."
  },
  {
   "term": "Linear search from the top",
   "def": "Scanning levels from the best price outward; fast because most updates are near the top."
  },
  {
   "term": "Branchless binary search",
   "def": "Binary search whose comparisons drive a conditional move instead of a branch."
  },
  {
   "term": "Order pool",
   "def": "Pre-allocated array of Order objects with a free list; O(1) allocate/free without malloc."
  },
  {
   "term": "Free list",
   "def": "Stack of unused pool slots."
  },
  {
   "term": "Intrusive FIFO",
   "def": "Per-level queue formed by prev/next pointers stored inside each order."
  },
  {
   "term": "Id index",
   "def": "Map from order id to its pooled Order, used for cancel and modify."
  },
  {
   "term": "Tail latency",
   "def": "High percentiles (p99, p99.9, max) of the latency distribution."
  },
  {
   "term": "rdtsc",
   "def": "x86 instruction reading the time-stamp counter; a cheap cycle-accurate timer."
  },
  {
   "term": "Differential fuzzing",
   "def": "Feeding random inputs to the fast and a reference implementation and comparing outputs."
  },
  {
   "term": "Book invariant",
   "def": "Property that must always hold, e.g. best bid < best ask and level totals equal order sums."
  },
  {
   "term": "Busy polling",
   "def": "Spinning on a queue or socket instead of blocking, trading CPU for wake-up latency."
  },
  {
   "term": "Core pinning",
   "def": "Binding a thread to a specific (isolated) CPU core."
  },
  {
   "term": "Kernel bypass",
   "def": "Reading/writing the network card from user space to avoid syscalls and interrupts."
  },
  {
   "term": "Cache warming",
   "def": "Running the hot path with dummy work so it stays in caches and predictors."
  },
  {
   "term": "Mechanical sympathy",
   "def": "Designing software around how the hardware (caches, pipeline, memory) actually works."
  }
 ],
 "mcqs": [
  {
   "q": "Why does the talk's order book keep levels in a vector with the **best** price at the **back**?",
   "options": [
    "Because std::vector cannot insert at the front",
    "Because most updates are near the top of book, and inserting/erasing near the end of a vector shifts only a few elements",
    "To make binary search possible",
    "Because the back of a vector is always in L1"
   ],
   "answer": 1,
   "explanation": "Vector insert cost is proportional to elements after the position; near-top operations at the back are cheap.",
   "distractors": "Vectors can insert at the front (expensively), sorting enables binary search either way, and nothing pins the back in L1.",
   "source": "lecture",
   "id": "L14-m1"
  },
  {
   "q": "Why can a linear search from the back beat std::lower_bound on the level vector for real market data?",
   "options": [
    "The target level is usually 1-3 positions from the top, and the linear scan is cache-friendly with predictable branches, while binary search mispredicts",
    "lower_bound is not allowed on vectors",
    "Linear search is O(log n)",
    "Linear search uses SIMD automatically"
   ],
   "answer": 0,
   "explanation": "With a skewed distribution, the expected scan length is tiny; binary search's 50/50 branches mispredict.",
   "distractors": "Linear search is O(n) in the worst case, lower_bound works on any sorted range, and vectorisation is not the reason.",
   "source": "lecture",
   "id": "L14-m2"
  },
  {
   "q": "What does a branchless binary search replace the comparison branch with?",
   "options": [
    "A system call",
    "A virtual call",
    "A hash lookup",
    "A conditional move selecting the next base pointer"
   ],
   "answer": 3,
   "explanation": "`base = (base[half] < key) ? base + half : base;` compiles to cmov, so no misprediction.",
   "distractors": "None of the other mechanisms are used in a binary search.",
   "source": "lecture",
   "id": "L14-m3"
  },
  {
   "q": "In the class `Order { uint id; ... uint timestampNs; }`, what is the main issue with `timestampNs` being 32-bit?",
   "options": [
    "It is signed",
    "It cannot be compared",
    "2^32 ns is about 4.3 s, so it wraps within seconds and breaks time ordering",
    "It makes the order unaligned"
   ],
   "answer": 2,
   "explanation": "A trading day is ~2.3e13 ns; 64 bits are needed (or a sequence number).",
   "distractors": "uint is unsigned, integers compare fine, and a 4-byte field is naturally aligned.",
   "source": "lecture",
   "id": "L14-m4"
  },
  {
   "q": "Which structure gives O(1) allocation of an Order with no malloc on the hot path?",
   "options": [
    "std::make_shared<Order>()",
    "A pre-allocated pool with a free list",
    "new Order",
    "std::map<Id, Order>::emplace"
   ],
   "answer": 1,
   "explanation": "Pop a slot from the free list; return it on fill or cancel.",
   "distractors": "The others all allocate from the heap.",
   "source": "lecture",
   "id": "L14-m5"
  },
  {
   "q": "In the capstone implementation, why do orders NOT store a pointer to their Level?",
   "options": [
    "Levels live inside a std::vector whose insert/erase moves elements, which would leave dangling Level pointers",
    "Pointers are slower than indices",
    "Levels are on the stack",
    "C++ forbids pointers between structs"
   ],
   "answer": 0,
   "explanation": "Vector elements move on insert/erase; the order stores its price and the cancel path finds the level by a near-top search.",
   "distractors": "Pointers are fine in general; the problem is element movement.",
   "source": "lecture",
   "id": "L14-m6"
  },
  {
   "q": "Why is it safe for the id index to hold `Order*` pointers into the pool?",
   "options": [
    "Because unordered_map copies the orders",
    "Because orders are const",
    "Because pointers are automatically updated",
    "Because the pool is a fixed-size array (vector sized once) that never reallocates, so its elements never move"
   ],
   "answer": 3,
   "explanation": "The pool is allocated once at startup; only its free list changes.",
   "distractors": "unordered_map stores the pointers only, nothing updates pointers automatically, and orders are mutable.",
   "source": "lecture",
   "id": "L14-m7"
  },
  {
   "q": "Paras SELL 10 @ 100 against bids 100.5 x 5 and 100 x 10. In the tick representation (tick 0.5), what does the capstone code print first?",
   "options": [
    "TRADE ... 5 @ 200",
    "TRADE ... 10 @ 200",
    "TRADE ... 5 @ 201",
    "BBO 201 x 5"
   ],
   "answer": 2,
   "explanation": "100.5 in ticks of 0.5 is 201. The sell hits the best bid level first at its resting price: 5 @ 201, then 5 @ 200.",
   "distractors": "Trading at 200 first would violate price priority; 10 @ 200 ignores the better bid; BBO is printed separately.",
   "source": "lecture",
   "id": "L14-m8"
  },
  {
   "q": "When the best level becomes empty during matching in the best-at-back design, removing it costs:",
   "options": [
    "O(L): erase from the front",
    "O(1): pop_back()",
    "O(log L): tree rebalancing",
    "O(n) over all orders"
   ],
   "answer": 1,
   "explanation": "The best level is the last element, so removal is pop_back.",
   "distractors": "There is no front erase, tree or full scan involved.",
   "source": "lecture",
   "id": "L14-m9"
  },
  {
   "q": "Which latency statistic matters most for judging an HFT order book's reliability?",
   "options": [
    "Tail percentiles such as p99 and p99.9 (and max)",
    "The minimum",
    "The median only",
    "The mean only"
   ],
   "answer": 0,
   "explanation": "Rare slow operations are the ones that lose races; the tail shows them.",
   "distractors": "Mean and median hide spikes; the minimum is the best case.",
   "source": "lecture",
   "id": "L14-m10"
  },
  {
   "q": "Which timer is cheapest for measuring per-message latency in cycles on x86?",
   "options": [
    "std::chrono::system_clock",
    "std::time()",
    "gettimeofday()",
    "__rdtsc()"
   ],
   "answer": 3,
   "explanation": "rdtsc reads the time-stamp counter in a handful of ns (needs invariant TSC and a cycles-to-ns factor).",
   "distractors": "system_clock/gettimeofday cost ~20 ns+ and follow wall time; std::time has second resolution.",
   "source": "lecture",
   "id": "L14-m11"
  },
  {
   "q": "What is the main risk of `std::unordered_map<Id, Order*> index;` without `reserve()` on the hot path?",
   "options": [
    "It cannot store pointers",
    "Lookups are O(log n)",
    "A rehash with reallocation can happen during trading, causing a large latency spike",
    "It is not sorted, so FIFO breaks"
   ],
   "answer": 2,
   "explanation": "Growing past the load factor triggers a rehash of every element and allocations.",
   "distractors": "It stores pointers fine, lookups are average O(1), and FIFO order is kept by the levels, not the index.",
   "source": "lecture",
   "id": "L14-m12"
  },
  {
   "q": "Why is the book typically owned by a single thread fed by SPSC queues?",
   "options": [
    "Because C++ cannot share objects between threads",
    "It avoids locks and cache-line contention on the book's data; SPSC queues need only acquire/release atomics",
    "Because SPSC queues sort the orders",
    "Because mutexes are not available in Linux"
   ],
   "answer": 1,
   "explanation": "One owner keeps the data hot in one core's cache with no synchronisation in the book itself.",
   "distractors": "Threads can share objects (with synchronisation), queues do not sort, and mutexes exist but cost too much.",
   "source": "lecture",
   "id": "L14-m13"
  },
  {
   "q": "A benchmark draws order prices uniformly over 1000 levels. What is the problem?",
   "options": [
    "Real flow concentrates near the top of book, so uniform data penalises near-top optimisations and can lead to choosing the wrong data structure",
    "It makes the benchmark too fast",
    "Prices must be doubles",
    "Nothing, uniform data is the most realistic"
   ],
   "answer": 0,
   "explanation": "The talk's key lesson is to optimise for the real distribution; uniform data hides why linear search wins.",
   "distractors": "Uniform data is unrealistic, not too fast, and prices should be integer ticks.",
   "source": "lecture",
   "id": "L14-m14"
  },
  {
   "q": "Which invariant must hold after every addOrder in a correct continuous matching engine?",
   "options": [
    "Every level holds exactly one order",
    "Best bid > best ask",
    "The number of bid levels equals the number of ask levels",
    "Best bid < best ask (when both sides are non-empty)"
   ],
   "answer": 3,
   "explanation": "Any crossing order is matched until it no longer crosses, so the book cannot remain crossed.",
   "distractors": "A crossed book is the error state; level counts and orders per level are unconstrained.",
   "source": "lecture",
   "id": "L14-m15"
  },
  {
   "q": "Why is `BookSide<bool IsBid>` a template in the capstone code instead of one class with a virtual `better()`?",
   "options": [
    "Templates use less memory than classes",
    "Virtual functions cannot compare integers",
    "The comparison is resolved at compile time and inlined into the search loop, with no indirect call or runtime side branch",
    "Templates make the code thread-safe"
   ],
   "answer": 2,
   "explanation": "Static polymorphism removes dispatch from the hottest loop.",
   "distractors": "Memory use is similar, virtual functions can compare anything, and templates do not add thread safety.",
   "source": "lecture",
   "id": "L14-m16"
  },
  {
   "q": "For a FOK (fill-or-kill) buy order, what must the engine do before trading?",
   "options": [
    "Nothing special; trade what it can",
    "Check that enough quantity is available at prices <= the limit, otherwise reject without trading",
    "Rest it first, then match",
    "Convert it to a market order"
   ],
   "answer": 1,
   "explanation": "FOK is all-or-nothing, so availability is checked first by summing crossing levels.",
   "distractors": "Partial trading is IOC behaviour; resting or converting changes the order's semantics.",
   "source": "lecture",
   "id": "L14-m17"
  },
  {
   "q": "Which practice keeps the hot path fast when trading signals are rare?",
   "options": [
    "Cache warming: periodically running the hot path with dummy data",
    "Logging every message with printf",
    "Allocating a new pool for each order",
    "Sleeping between messages to save power"
   ],
   "answer": 0,
   "explanation": "Rarely-run code and data get evicted; warming keeps them in cache and keeps predictors trained.",
   "distractors": "Sleeping adds wake-up latency, printf is a syscall path, and per-order pools allocate.",
   "source": "lecture",
   "id": "L14-m18"
  },
  {
   "q": "How should a cancel for an unknown id be handled by `removeOrder`?",
   "options": [
    "Remove the best order instead",
    "Crash with an assertion in production",
    "Scan all levels to be sure",
    "Ignore it (or report a reject) after a failed index lookup"
   ],
   "answer": 3,
   "explanation": "Unknown ids happen (already filled, duplicates); the index lookup fails and nothing changes.",
   "distractors": "Crashing, scanning and removing other orders are all wrong.",
   "source": "lecture",
   "id": "L14-m19"
  },
  {
   "q": "Which tool combination best validates a heavily optimised order book's correctness?",
   "options": [
    "Only compiling with -O3",
    "Running it once on the class example",
    "Differential fuzzing against a simple std::map reference book, with invariant checks and sanitizers",
    "Measuring p99 latency"
   ],
   "answer": 2,
   "explanation": "Random streams compared against a trusted model plus invariants and ASan/UBSan catch logic bugs and UB.",
   "distractors": "Optimisation flags and latency numbers say nothing about correctness; one example is not enough.",
   "source": "lecture",
   "id": "L14-m20"
  },
  {
   "q": "Which operation is the most frequent in real exchange order flow and should be fast?",
   "options": [
    "Trades sweeping 50 levels",
    "Adding and cancelling orders near the top of book",
    "Market orders on an empty book",
    "Re-centring the price array"
   ],
   "answer": 1,
   "explanation": "Most messages are adds and cancels close to the BBO (most orders are cancelled, not filled).",
   "distractors": "Deep sweeps, empty-book market orders and re-centring are rare.",
   "source": "lecture",
   "id": "L14-m21"
  }
 ],
 "msqs": [
  {
   "q": "Which of the following were requirements in the class capstone notes? (select all that apply)",
   "options": [
    "Price-time priority",
    "Support 1000 price levels",
    "A getBBO() returning the top bid and ask",
    "Pro-rata allocation",
    "Matching of crossing orders"
   ],
   "answers": [
    0,
    1,
    2,
    4
   ],
   "explanation": "capstone.txt lists price-time priority, 1000 price levels, the OrderBook interface with getBBO, and matching. Pro-rata is an alternative matching rule not in the brief.",
   "id": "L14-x1"
  },
  {
   "q": "Which statements about the best-at-back vector design are true? (select all that apply)",
   "options": [
    "Removing the best level is pop_back()",
    "A new best price is inserted near the end with few element moves",
    "Inserting deep in the book can move many elements",
    "It requires a heap allocation per level",
    "Levels are contiguous in memory"
   ],
   "answers": [
    0,
    1,
    2,
    4
   ],
   "explanation": "The back holds the best price, so near-top operations are cheap, deep inserts shift more, and storage is contiguous. After reserve there is no per-level allocation.",
   "id": "L14-x2"
  },
  {
   "q": "Which are advantages of a linear search from the top over std::lower_bound for finding a level? (select all that apply)",
   "options": [
    "Usually stops after 1-3 comparisons on real data",
    "Predictable branches",
    "Better worst-case complexity",
    "Touches only one or two cache lines near the top",
    "Works on unsorted data"
   ],
   "answers": [
    0,
    1,
    3
   ],
   "explanation": "Short, predictable, cache-local scans are the win. The worst case is O(L), worse than O(log L), and the levels must still be sorted for the stop condition.",
   "id": "L14-x3"
  },
  {
   "q": "Which fixes to the class notes are needed for a production-quality book? (select all that apply)",
   "options": [
    "64-bit order ids and timestamps",
    "Integer tick prices instead of floating point",
    "Bids sorted descending and asks ascending (or best-at-back equivalents)",
    "Using std::vector<Order> with erase(begin()) as the FIFO",
    "An id index for O(1) cancel"
   ],
   "answers": [
    0,
    1,
    2,
    4
   ],
   "explanation": "Wider ids/timestamps, tick prices, correct ordering and an id index all fix real problems. erase(begin()) on a vector is O(n) and is one of the problems.",
   "id": "L14-x4"
  },
  {
   "q": "Which properties make the order pool suitable for the hot path? (select all that apply)",
   "options": [
    "O(1) allocate and free via a free list",
    "No malloc or free calls while trading",
    "Elements never move, so pointers to them stay valid",
    "Automatic garbage collection",
    "Predictable memory layout and locality"
   ],
   "answers": [
    0,
    1,
    2,
    4
   ],
   "explanation": "A pre-allocated pool gives constant-time, allocation-free, stable, contiguous storage. C++ has no garbage collection; the code returns slots explicitly.",
   "id": "L14-x5"
  },
  {
   "q": "Which are valid reasons the talk prefers contiguous containers over std::map for the book? (select all that apply)",
   "options": [
    "Fewer cache misses from pointer chasing",
    "No per-node heap allocation",
    "Better exploitation of the top-of-book data distribution",
    "std::map is not sorted",
    "Hardware prefetching works on sequential memory"
   ],
   "answers": [
    0,
    1,
    2,
    4
   ],
   "explanation": "Contiguity avoids pointer chasing and allocations, lets near-top work stay local, and suits the prefetcher. std::map is sorted; that is not the issue.",
   "id": "L14-x6"
  },
  {
   "q": "Which of these belong on the hot path of a low-latency book? (select all that apply)",
   "options": [
    "Integer comparisons of tick prices",
    "printf of every trade",
    "Unlinking an order from an intrusive list",
    "std::map insert allocating a node",
    "Updating a level's aggregate quantity"
   ],
   "answers": [
    0,
    2,
    4
   ],
   "explanation": "Integer compares, O(1) unlinks and aggregate updates are cheap and allocation-free. printf does formatting and syscalls, and map inserts allocate.",
   "id": "L14-x7"
  },
  {
   "q": "Which statements about measuring the book's latency are true? (select all that apply)",
   "options": [
    "Report p50, p99, p99.9 and max",
    "rdtsc is cheaper than calling a wall-clock function",
    "Warm-up iterations should be included in the statistics",
    "Realistic replayed market data gives more meaningful results than uniform random prices",
    "Pinning the benchmark thread reduces noise"
   ],
   "answers": [
    0,
    1,
    3,
    4
   ],
   "explanation": "Percentiles, cheap timers, realistic data and pinning give trustworthy numbers. Warm-up iterations (cold caches, page faults) should be discarded.",
   "id": "L14-x8"
  },
  {
   "q": "Which invariants should a test harness check after every operation? (select all that apply)",
   "options": [
    "Best bid < best ask when both sides are non-empty",
    "Each level's total equals the sum of its orders' quantities",
    "No empty level remains in the book",
    "All bid prices are equal",
    "Every indexed order is linked in exactly one level"
   ],
   "answers": [
    0,
    1,
    2,
    4
   ],
   "explanation": "These are the structural invariants of a correct book. Bid prices naturally differ across levels.",
   "id": "L14-x9"
  },
  {
   "q": "Which system-level techniques from the course and talk reduce latency around the book? (select all that apply)",
   "options": [
    "Pinning threads to isolated cores",
    "Busy-polling SPSC queues",
    "Kernel-bypass networking",
    "Protecting the book with a global mutex taken by every thread",
    "Pre-faulting memory and using huge pages"
   ],
   "answers": [
    0,
    1,
    2,
    4
   ],
   "explanation": "Pinning, polling, kernel bypass and pre-faulting all remove scheduler, syscall or page-fault delays. A global mutex adds contention and blocking.",
   "id": "L14-x10"
  },
  {
   "q": "Which order types can reuse the same matching loop with small changes? (select all that apply)",
   "options": [
    "Limit (rest the remainder)",
    "IOC (cancel the remainder)",
    "Market (no price check, cancel the remainder)",
    "FOK (needs an availability check before matching)"
   ],
   "answers": [
    0,
    1,
    2
   ],
   "explanation": "Limit, IOC and market differ only in the price check and in what happens to the remainder. FOK needs an extra check first, so the plain loop is not enough on its own.",
   "id": "L14-x11"
  },
  {
   "q": "Which of these are problems with the priority_queue + lazy deletion design for this capstone? (select all that apply)",
   "options": [
    "Cancelled orders stay in the heap until they reach the top",
    "No cheap aggregate quantity per price level for getBids()/getAsks()",
    "Getting the best order is O(n)",
    "Heavy cancel traffic bloats memory",
    "Every top-of-heap pop has to check whether the order was cancelled"
   ],
   "answers": [
    0,
    1,
    3,
    4
   ],
   "explanation": "Lazy deletion leaves stale entries, lacks per-level aggregation, grows under cancels and needs a check on every pop. The best order is the heap top, O(1).",
   "id": "L14-x12"
  },
  {
   "q": "Which statements about using templates in the capstone code are correct? (select all that apply)",
   "options": [
    "BookSide<true> and BookSide<false> are separate types generated at compile time",
    "better() can be inlined into find()",
    "The template adds a v-table pointer to each BookSide",
    "The same match() template works for both sides with a lambda for the cross condition"
   ],
   "answers": [
    0,
    1,
    3
   ],
   "explanation": "Each instantiation is its own type with an inlinable comparison, and match() is generic over the side and the crossing predicate. Templates do not add v-tables.",
   "id": "L14-x13"
  }
 ],
 "short": [
  {
   "q": "Summarise the order-book design ideas from David Gross's CppCon 2024 talk and explain why each one is faster than the std::map baseline.",
   "checks": [
    {
     "label": "Vector of levels",
     "patterns": [
      "vector"
     ]
    },
    {
     "label": "Best price at the back",
     "patterns": [
      "back",
      "end of the vector"
     ]
    },
    {
     "label": "Linear search beats binary on real data",
     "patterns": [
      "linear search",
      "linear scan"
     ]
    },
    {
     "label": "Branchless binary search",
     "patterns": [
      "branchless"
     ]
    },
    {
     "label": "Cache / branch prediction reasoning",
     "patterns": [
      "cache",
      "mispredict",
      "branch predict"
     ]
    },
    {
     "label": "Data distribution near the top of book",
     "patterns": [
      "top of (the )?book",
      "near the top",
      "distribution"
     ]
    }
   ],
   "modelAnswer": "1. **Contiguous `std::vector` of price levels instead of `std::map`**: no node allocation per level and no pointer chasing; levels sit in a few cache lines and the prefetcher streams them.\n2. **Best price at the back of the vector**: insert/erase cost is the number of elements after the position, and most updates are near the top of book, so putting the top at the end means only a few elements shift; consuming the best level is `pop_back()`.\n3. **Linear search from the back instead of binary search**: given the data distribution (most activity within a few levels of the BBO), the scan usually stops after 1-3 elements with predictable branches, while `std::lower_bound` mispredicts on its ~50/50 comparisons. On real data linear search won.\n4. **Branchless binary search** for cases deeper in the book: the comparison feeds a conditional move (cmov), so there is no branch to mispredict.\n5. The general lesson: measure on realistic data, know your distribution, and prefer cache-friendly, predictable code over asymptotic complexity alone.",
   "explanation": "Name the design steps and tie each to cache behaviour, branch prediction or the data distribution.",
   "id": "L14-s1"
  },
  {
   "q": "Design the data structures for the capstone book so that add, cancel, execute and BBO are all fast without heap allocation on the hot path. Justify each choice.",
   "checks": [
    {
     "label": "Pre-allocated pool / free list",
     "patterns": [
      "pool",
      "free list"
     ]
    },
    {
     "label": "Intrusive FIFO per level (price-time)",
     "patterns": [
      "intrusive",
      "prev.*next",
      "FIFO"
     ]
    },
    {
     "label": "Id index for cancel",
     "patterns": [
      "hash",
      "unordered_map",
      "index"
     ]
    },
    {
     "label": "Contiguous levels (vector/array), best at back or tick-indexed",
     "patterns": [
      "vector",
      "array"
     ]
    },
    {
     "label": "Integer tick prices",
     "patterns": [
      "tick",
      "integer"
     ]
    }
   ],
   "modelAnswer": "- **Prices** are integer ticks (`int64_t`): exact equality, cheap compares.\n- **Levels**: per side a `std::vector<Level>` reserved at startup, sorted with the best price at the back (or, for a bounded 1000-level range, an array indexed by tick with a bitmap of non-empty levels). Each `Level` stores price, aggregate qty, and head/tail of its FIFO. BBO = `back()` in O(1).\n- **Orders**: a pre-allocated pool (`std::vector<Order>` sized once) plus a free list; allocate/free are O(1) pops and pushes, no malloc, and pointers never move.\n- **FIFO**: an intrusive doubly linked list (`prev`/`next` inside `Order`): append at the tail for time priority, fill from the head, O(1) unlink for cancels.\n- **Id index**: a reserved `unordered_map<Id, Order*>` (better: a flat open-addressing table or an array if ids are dense) gives O(1) cancel/modify lookup.\n- **Execute**: match against `back()` of the opposite side, take the head order, and `pop_back()` the level when empty.\n- Orders store their price, not a `Level*`, because vector elements move; the cancel path finds the level by a near-top linear search.",
   "explanation": "A coherent design where every structure is justified by an operation's cost.",
   "id": "L14-s2"
  },
  {
   "q": "Write a branchless lower_bound over a sorted array of prices and explain why it can beat std::lower_bound.",
   "checks": [
    {
     "label": "cmov-friendly ternary updating base",
     "patterns": [
      "\\?\\s*base\\s*\\+\\s*half\\s*:\\s*base",
      "cmov"
     ]
    },
    {
     "label": "Halving loop",
     "patterns": [
      "half",
      "n\\s*/\\s*2",
      ">>\\s*1"
     ]
    },
    {
     "label": "Final adjustment",
     "patterns": [
      "\\*base\\s*<\\s*key"
     ]
    },
    {
     "label": "Explains misprediction avoidance",
     "patterns": [
      "mispredict",
      "no branch",
      "branch-free|branchless"
     ]
    }
   ],
   "modelAnswer": "```cpp\nstd::size_t branchless_lower_bound(const Price* a, std::size_t n, Price key) {\n    if (n == 0) return 0;\n    const Price* base = a;\n    while (n > 1) {\n        std::size_t half = n / 2;\n        base = (base[half] < key) ? base + half : base;   // cmov, not a jump\n        n -= half;\n    }\n    return static_cast<std::size_t>(base - a) + (*base < key);\n}\n```\n\nIt returns the same index as `std::lower_bound` (first element >= key). In a normal binary search each comparison is a data-dependent branch that goes either way ~50 % of the time, so it mispredicts about half the time (~15-20 cycles each). Here the comparison result selects the next `base` with a conditional move, so there is no branch to mispredict; the loop count depends only on n, which is perfectly predictable. The cost is a dependency chain of loads, which is still faster when the array fits in cache.",
   "explanation": "Correct algorithm and the reason: replacing unpredictable branches with cmov.",
   "id": "L14-s3"
  },
  {
   "q": "Explain how you would measure and report the latency of the capstone order book, and which mistakes would make the numbers misleading.",
   "checks": [
    {
     "label": "Per-operation timing with rdtsc or steady_clock",
     "patterns": [
      "rdtsc",
      "steady_clock"
     ]
    },
    {
     "label": "Percentiles / tail",
     "patterns": [
      "p99",
      "percentile",
      "tail"
     ]
    },
    {
     "label": "Realistic data / replay",
     "patterns": [
      "realistic",
      "replay",
      "market data"
     ]
    },
    {
     "label": "Warm-up / pinning / noise",
     "patterns": [
      "warm",
      "pin",
      "isolat"
     ]
    },
    {
     "label": "Dead code elimination or -O0 mistake",
     "patterns": [
      "optimi[sz]ed away",
      "dead[- ]code",
      "-O0",
      "sink"
     ]
    }
   ],
   "modelAnswer": "- Replay realistic market data (or a generator with the real distribution: most adds/cancels near the top of book, many cancels) through the book.\n- Time each operation with `__rdtsc()` (a few ns) or `steady_clock` for batches; store samples in a pre-reserved vector; convert cycles to ns with the TSC frequency.\n- Report the distribution: p50, p99, p99.9 and max (the tail), plus throughput, separately for add, cancel and aggressive orders.\n- Control noise: warm up first and discard warm-up samples (cold caches, page faults), pin the thread to an isolated core, disable frequency scaling, repeat runs.\n- Use `perf stat` for IPC, cache misses and branch misses to explain the numbers.\n\nMisleading mistakes: benchmarking a -O0 build; letting results be optimised away (dead-code elimination; use the outputs or a global sink as in the class SPSC benchmark); uniform random prices; reporting only the mean; timing with `system_clock`; including warm-up; allocating or printing inside the timed region.",
   "explanation": "A reproducible method focused on tail latency and realistic data.",
   "id": "L14-s4"
  },
  {
   "q": "Describe how you would test that your optimised order book is correct.",
   "checks": [
    {
     "label": "Reference implementation",
     "patterns": [
      "reference",
      "std::map",
      "naive"
     ]
    },
    {
     "label": "Random / differential fuzzing",
     "patterns": [
      "fuzz",
      "random",
      "differential"
     ]
    },
    {
     "label": "Invariant: never crossed",
     "patterns": [
      "bid\\s*<\\s*(best )?ask",
      "crossed"
     ]
    },
    {
     "label": "Invariant: level totals",
     "patterns": [
      "total",
      "sum"
     ]
    },
    {
     "label": "Sanitizers",
     "patterns": [
      "sanitiz",
      "ASan",
      "UBSan"
     ]
    }
   ],
   "modelAnswer": "1. Write a simple reference book (`std::map<Price, std::list<Order>>` per side with an id map) that is obviously correct.\n2. Differential fuzzing: generate random streams of adds, cancels (including unknown ids), modifies and crossing orders; feed both books; after every message compare the trades emitted and the full book state.\n3. Check invariants after each operation in debug builds: best bid < best ask whenever both sides exist (never crossed); each level's total equals the sum of its order quantities; levels strictly sorted with no empty levels; every indexed order is in exactly one level; pool free count + live orders = capacity.\n4. Scenario tests: the class Kartik/Manik/Paras example, FIFO at one price, sweeping several levels, cancelling head/middle/tail orders, empty-side BBO, FOK reject, IOC remainder.\n5. Build the tests with `-fsanitize=address,undefined` to catch use-after-free of pooled orders, out-of-bounds and UB.",
   "explanation": "Reference model, fuzzing, invariants and sanitizers.",
   "id": "L14-s5"
  },
  {
   "q": "Explain how the capstone book fits into a full low-latency trading process and which earlier course topics (SPSC queue, false sharing, pinning) are used there.",
   "checks": [
    {
     "label": "SPSC queues in and out",
     "patterns": [
      "SPSC"
     ]
    },
    {
     "label": "Single owner thread / no locks",
     "patterns": [
      "single thread",
      "one thread",
      "no locks",
      "lock-free"
     ]
    },
    {
     "label": "False sharing / alignas(64)",
     "patterns": [
      "false sharing",
      "alignas\\(64\\)"
     ]
    },
    {
     "label": "Core pinning / busy-polling",
     "patterns": [
      "pin",
      "busy[- ]poll"
     ]
    },
    {
     "label": "No allocation / syscalls on hot path",
     "patterns": [
      "no (heap )?allocation",
      "syscall",
      "malloc"
     ]
    }
   ],
   "modelAnswer": "The pipeline is: network thread receives market data, decodes it and pushes messages into an SPSC queue; one thread owns the book (one book per instrument or group, no locks), applies each message and publishes BBO changes and trades through another SPSC queue to the strategy, which sends orders out through the gateway.\n\nCourse topics used:\n\n- The **SPSC ring buffer** from class (power-of-two capacity, `t & kMask`, `tail_`/`head_` atomics with release/acquire), lock-free between exactly one producer and one consumer.\n- **False sharing**: `alignas(64)` on `head_` and `tail_` so the producer's and consumer's indices sit on different cache lines (otherwise MESI ping-pong, visible as HITM in `perf c2c`).\n- **Core pinning and busy-polling**: each thread is pinned to an isolated core and spins on its queue, avoiding scheduler wake-up latency.\n- **No allocation or syscalls on the hot path**: order pool, reserved vectors, async logging; kernel-bypass networking at the edges.\n- Compiler and micro-optimisations: templates instead of virtual calls, branch-predictable code, integer ticks, and benchmarks with a global sink at -O3 -march=native.",
   "explanation": "Connect the capstone to concurrency and architecture topics from earlier sessions.",
   "id": "L14-s6"
  }
 ],
 "quiz": [],
 "coding": [
  {
   "id": "order-book",
   "title": "Price-Time Priority Order Book"
  },
  {
   "id": "price-level-book",
   "title": "Cache-Friendly Price-Level Array Book"
  }
 ],
 "prev": {
  "num": 13,
  "file": "lecture-13.html"
 },
 "next": null
};
