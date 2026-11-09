# Syntropy

![Realms hanging from their rulers, coloured by tribe](docs/hero.png)

### [**Watch it run →**](https://syntropy-sim.vercel.app)

Syntropy is a 3D take on Conway's Game of Life that keeps climbing. Coloured cells on a lattice settle into forms, the forms become organisms, the organisms group into tribes, and the tribes end up in hierarchies where some organisms rule others. Every so often a realm survives the death of its ruler, which is the point where I'd call it a government.

Nothing in the code says "tribe", "rank" or "government". Each level is a handful of local rules plus a measurement that notices when the next kind of order shows up. It all runs in your browser, there's no server, and every world has a seed in the URL so you can send someone the exact same history.

## The ladder

| Level | What runs | Reached when |
| --- | --- | --- |
| 1. Cells | 3D Life on a 48³ lattice: a dead cell with 7 or 8 live neighbours is born, a live cell with 1 to 5 survives. Newborns take the most common lineage around them. | 56 forms hold their shape for 20 generations |
| 2. Organisms | Each form becomes one body at the same spot. Bodies eat from a food field that regrows, move, split when they're rich, and age. | The forms become bodies |
| 3. Tribes | A newborn follows its parent. A ruler or a loner bows to a much stronger kin polity nearby, sooner when foreigners crowd it. | 3 kin groups of 12+ follow chiefs |
| 4. Hierarchy | Members of two polities that touch can fight. Local numbers decide, and a clear winner takes the loser (and everyone below it) as followers. Followers pay tribute upward and get fed when they starve. A lord manages 5 followers directly, so newcomers are handed down the tree. | One realm of 40+ rules 2 tribes through 5 ranks |
| 5. Government | A follower whose branch outgrows the rest of the realm may break away or take the throne. When a ruler dies, the strongest follower inherits, and the others stay only if the heir is clearly stronger. | A realm of 40+ outlives its ruler and keeps 60% of its members |

Levels can only be reached in order.

## Reading the picture

- **Fill colour** is the tribe (lineage) an organism was born into: Blue, Red, Gold, Green, Violet, Rose.
- **A line** runs from every follower up to its lord, in the colour of the ruler's tribe. A Blue line through a Red organism means Blue rules it.
- **Followers settle just below their lord**, so a realm hangs from its ruler like an upside-down tree, and siblings spread apart in proportion to the size of their branches.
- **A ring** marks a ruler. Bigger bodies have more organisms below them.
- **Green stipple** is food. You can watch it thin out where a realm grazes.
- Hover an organism to trace its chain of command and see its rank.

## Tuning without graphics

The simulation core in `src/sim` is plain TypeScript with no browser dependencies, so Node runs it directly (Node 22.18+ strips the types).

```bash
npm run world -- --seed demo --ticks 15000
```

That prints one world's history as a chronicle (100 ticks to a year) with the ladder times and counts at the end:

```
y 12 *** Tribes: 3 kin groups now follow chiefs.
y 31     Peko conquers Lorin and its 23.
y 34 *** Hierarchy: Peko rules 3 tribes through 6 ranks.
y 52 *** Government: Peko survives the death of its ruler.
```

```bash
npm run sweep -- --sets 160 --refine 72 --seeds 6 --ticks 12000
```

The sweep does a random search over 35 parameters, refines around the four best sets, then checks the three finalists on 16 seeds it never trained on, across worker threads. It scores each run on whether every level arrives, in order and not too early, how many major realms stand, how much of the population they hold, and whether there's some war, rebellion and collapse along the way. The winner goes to `tuning/best.json` and the full table to `tuning/runs/`.

To watch a parameter file in the browser:

```bash
npm run url -- tuning/best.json --base http://localhost:5173
```

The current defaults came out of that loop. On 16 fresh seeds they reach Tribes in RESULT_TRIBES, Hierarchy in RESULT_HIER and Government in RESULT_GOV of runs.

## Running it

```bash
npm install
npm run dev
```

`npm run build` writes a static site to `dist/`. It's Vite and Three.js with nothing on the server, so hosting it costs the same as hosting a picture. Keys: space pauses, `N` makes a new world, `1` to `4` set the speed.

## Layout

- `src/sim/cells.ts` is the lattice and form tracking.
- `src/sim/society.ts` holds the organisms, polities, events and ladder checks.
- `src/sim/score.ts` turns a run into numbers and a score.
- `src/render/` has the voxel, sphere, line and food drawing.
- `src/ui/hud.ts` is the ladder, chronicle and readouts.
- `scripts/` holds the headless runner, sweep, rule search and URL helper.

The look follows `docs/taste/ciechanow.ski.md`: one paper ground, gray controls, a single 1.5px ink outline, and colour spent only on the organisms and the words that name them.

MIT licensed.
