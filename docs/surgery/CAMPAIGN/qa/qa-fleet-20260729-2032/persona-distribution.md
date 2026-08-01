# Persona distribution — 250 strangers

- **run_id** `qa-fleet-20260729-2032`
- **seed string** `qa-fleet-20260729-2032` → **seed int** `1387006667` (sha256 → uint32LE, mulberry32)
- **unique constraint tuples** 250/250 — enforced programmatically; 250 draws to fill 250 slots
- re-running `node personas.mjs` reproduces `personas.jsonl` byte-for-byte

### Difficulty tier

| value | n | % |
|---|---:|---:|
| EASY | 142 | 56.8% |
| HARD | 61 | 24.4% |
| IMPOSSIBLE | 32 | 12.8% |
| ROBUSTNESS | 15 | 6.0% |

### Horizon requested

| value | n | % |
|---|---:|---:|
| day | 185 | 74.0% |
| week | 65 | 26.0% |

### Goal

| value | n | % |
|---|---:|---:|
| cut | 162 | 64.8% |
| lean bulk | 38 | 15.2% |
| maintain | 26 | 10.4% |
| recomp | 24 | 9.6% |

### Dietary style sent to the API

| value | n | % |
|---|---:|---:|
| none | 97 | 38.8% |
| vegan | 30 | 12.0% |
| null | 28 | 11.2% |
| vegetarian | 23 | 9.2% |
| mediterranean | 20 | 8.0% |
| keto | 18 | 7.2% |
| paleo | 13 | 5.2% |
| kosher | 12 | 4.8% |
| halal | 7 | 2.8% |
| carnivore | 2 | 0.8% |

### Walls per persona

| value | n | % |
|---|---:|---:|
| 0 wall(s) | 52 | 20.8% |
| 1 wall(s) | 47 | 18.8% |
| 4 wall(s) | 42 | 16.8% |
| 2 wall(s) | 36 | 14.4% |
| 3 wall(s) | 33 | 13.2% |
| 5 wall(s) | 29 | 11.6% |
| 6 wall(s) | 7 | 2.8% |
| 8 wall(s) | 2 | 0.8% |
| 9 wall(s) | 1 | 0.4% |
| 7 wall(s) | 1 | 0.4% |

### Wall type (persona-count, multi-count)

| value | n | % |
|---|---:|---:|
| gluten | 94 | 37.6% |
| soy | 83 | 33.2% |
| dairy | 64 | 25.6% |
| shellfish | 56 | 22.4% |
| peanut | 54 | 21.6% |
| pork | 46 | 18.4% |
| sesame | 42 | 16.8% |
| tree nut | 37 | 14.8% |
| beef | 35 | 14.0% |
| egg | 33 | 13.2% |
| fish | 25 | 10.0% |
| nightshade | 23 | 9.2% |
| cilantro | 13 | 5.2% |

### Rate (lb/wk)

| value | n | % |
|---|---:|---:|
| 2 | 70 | 28.0% |
| 0.5 | 58 | 23.2% |
| 1.5 | 51 | 20.4% |
| 1 | 36 | 14.4% |
| 0.25 | 35 | 14.0% |

### Macro style

| value | n | % |
|---|---:|---:|
| balanced | 70 | 28.0% |
| high-protein | 66 | 26.4% |
| low-fat | 59 | 23.6% |
| low-carb | 55 | 22.0% |

### Sex

| value | n | % |
|---|---:|---:|
| M | 144 | 57.6% |
| F | 106 | 42.4% |

### Meals per day

| value | n | % |
|---|---:|---:|
| 3 | 132 | 52.8% |
| 4 | 48 | 19.2% |
| 2 | 32 | 12.8% |
| 5 | 31 | 12.4% |
| 9 | 6 | 2.4% |
| 0 | 1 | 0.4% |

### Occupation key

| value | n | % |
|---|---:|---:|
| unemployed-home | 19 | 7.6% |
| warehouse | 18 | 7.2% |
| mining | 17 | 6.8% |
| software-tech | 17 | 6.8% |
| desk-office | 15 | 6.0% |
| cashier | 14 | 5.6% |
| driver-truck | 14 | 5.6% |
| landscaper | 13 | 5.2% |
| formwork-concrete | 12 | 4.8% |
| electrician | 11 | 4.4% |
| personal-trainer | 11 | 4.4% |
| chef-kitchen | 11 | 4.4% |
| teacher | 10 | 4.0% |
| trades-general | 9 | 3.6% |
| nurse-healthcare | 8 | 3.2% |
| carpenter-finish | 8 | 3.2% |
| accounting-finance | 8 | 3.2% |
| driver-rideshare | 8 | 3.2% |
| firefighter | 7 | 2.8% |
| commercial-fishing | 7 | 2.8% |
| security-guard | 7 | 2.8% |
| student | 6 | 2.4% |

### Robustness sub-kind

| value | n | % |
|---|---:|---:|
| unicode-name | 6 | 2.4% |
| nine-meals | 6 | 2.4% |
| long-allergy-note | 1 | 0.4% |
| keto-with-carb-target | 1 | 0.4% |
| zero-meals | 1 | 0.4% |

### Impossible sub-kind

| value | n | % |
|---|---:|---:|
| every-protein-walled | 18 | 7.2% |
| floor-vs-rate | 14 | 5.6% |


### Body spread

| stat | min | median | max |
|---|---:|---:|---:|
| age | 19 | 46 | 78 |
| BMI | 17.2 | 31 | 45 |
| weight kg | 39.7 | 91.3 | 169.5 |
| height cm | 148 | 174 | 199 |

### Requested-but-unsupported (product gaps, carried on the persona cards)

- **66 persona(s)** — wanted protein set explicitly in g/lb
- **59 persona(s)** — wanted a low-fat split
- **48 persona(s)** — wanted a low-carb split without full keto
- **32 persona(s)** — this request is mathematically unsatisfiable by design — a clear, fast, honest refusal is the pass condition, and a confident plan is a critical honesty defect
- **16 persona(s)** — pescatarian is not one of the 9 dietary styles
- **14 persona(s)** — low-FODMAP is not a dietary style
- **3 persona(s)** — managing meals for a 12-year-old
- **2 persona(s)** — managing meals for a 16-year-old
- **2 persona(s)** — managing meals for a 13-year-old
- **2 persona(s)** — managing meals for a 14-year-old
- **1 persona(s)** — managing meals for a 17-year-old
- **1 persona(s)** — typed a 300-character allergy narrative
- **1 persona(s)** — managing meals for a 15-year-old

- personas carrying at least one unsupported wish: **192/250**
- personas with a parent-managed dependent: **11** (no API surface exists for this)
- personas typing a free-text wall outside the app's 10-key picker: **101**
