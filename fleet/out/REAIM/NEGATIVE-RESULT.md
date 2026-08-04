# REAIM — a negative result, kept on purpose

**Treatment:** point the search's fat target at the *range* the verdict grades
(20–35 %E, floored at `fatFloorG`) instead of at the midpoint of the target's gram
band. Zero penalty anywhere inside; penalty only outside.

**Result: −3.2 pp. Reverted.**

| | satisfiable (3-seed mean) |
|---|--:|
| point aim — `fleet/out/RULER10/` | **80.6 %** |
| range aim — this directory | **77.4 %** |

Per seed: 78.6 / 76.7 / 76.9 against 80.1 / 81.4 / 80.3. All instrument checks 0.

## Why it lost

| | point aim | range aim |
|---|--:|--:|
| fat inside the guardrail | 83.0 % | 79.8 % |
| median margin to the nearer edge | 35.6 % of range | 32.1 % |
| days hugging an edge (<10 % of range) | 5.8 % | **10.1 %** |

A point target inside a range is not over-constraint — it is **centering**, and
centering is slack management. A day parked mid-guardrail can absorb the portion
scaling and the macro closer still to come. A day on the edge cannot.

## The argument that motivated it, and why it was misleading

The search aims at a band 16 % wide (as a share of its midpoint); the verdict allows
54 %. And of 510 failing days, 340 (67 %) had fat inside the guardrail already and
failed on calories or protein anyway — so the fat pull looked like it bought nothing.

Both numbers are correct. The inference was not: **those days had fat inside the
guardrail *because* the point aim put it there.** Reading a satisfied constraint as
an unnecessary one is the trap.

## If revisited

A *soft* deadband — partial credit near the middle rather than zero — is the only
variant worth testing. A hard deadband has been measured and starts 3.2 pp down.
