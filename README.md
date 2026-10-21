# High Performance C++: End-term Revision

An interactive revision site for **High Performance C++** (low-latency / HFT C++): 14 sessions, each with one-shot notes,
key terms, MCQs, multi-select questions (MSQs) and written questions, plus exam-style C++ coding problems with tested
solutions and links to similar problems on LeetCode and other platforms.

**Live site:** https://rudhar07.github.io/high_performance_cpp-practice/

| # | Session | # | Session |
|---|---|---|---|
| 1 | Getting started with C++ | 8 | Computer Architecture for HFT |
| 2 | Pointers and References | 9 | Atomics and Concurrency |
| 3 | Pointers and References 2 | 10 | Atomics and Concurrency 2 |
| 4 | Memory Management + STL | 11 | Compiler Optimisation and Perf tuning |
| 5 | Templates and Generic Programming | 12 | Fast Orderbooks |
| 6 | Metaprogramming and Move Semantics | 13 | Low latency C++ hacks |
| 7 | Move Semantics 2 + Smart Pointers | 14 | Capstone: low-latency order book |

## What's on each session page

- **One-shot notes:** every syllabus topic, with C++ examples, tables, *Quick revision* and *Exam traps*. Points taken from
  the code written in class are marked **In class**, including the bugs in that code and how to fix them.
- **Key terms:** a quick glossary.
- **MCQs:** one correct option. Green if right, red if wrong, with an explanation either way.
- **MSQs:** select all correct options, then press *Submit*. It counts as right only if you pick exactly the correct set;
  otherwise it shows which picks were wrong and which correct options you missed.
- **Written answers:** type an answer and press *Check answer*. You see which key points you covered, and a model answer.

The **Coding practice** page has the course's Memory Pool problem and similar problems in the exam's format (description,
signature, constraints, example). Each has hints, a key-idea checker, and a solution plus tests that were compiled and run
with sanitizers. Below them are similar problems on LeetCode and other platforms.

Progress is saved in your browser (it survives closing the tab). There's a light (cream) and a dark (purple) theme.

## Structure

```
index.html                 home: sessions, coding practice, overall progress
lectures/lecture-NN.html   one page per session (generated)
coding/index.html          coding problems + LeetCode / other links (generated)
assets/style.css, app.js   styles and the app (notes, MCQ/MSQ/written checking, coding page, progress)
data/content/*.json        notes, key terms and questions per session
data/coding/coding.json    coding problems, solutions, tests and links
data/*.js                  generated page data
tools/build.py             regenerates pages and data, and validates everything
```

To rebuild after editing anything in `data/`, run `python3 tools/build.py`. The build fails on malformed content: bad answer
indices, MSQs with fewer than two correct options, or a model answer or solution that doesn't pass its own checks.

## Hosting

Repo → **Settings → Pages → Deploy from a branch → `main` / `(root)` → Save**. Plain static files, with `.nojekyll`.
