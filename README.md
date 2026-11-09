# Syntropy

![Realms hanging from their rulers, coloured by tribe](docs/hero.png)

### [**Watch it run →**](https://syntropy-sim.vercel.app)

Syntropy is a 3D take on Conway's Game of Life that keeps climbing. Coloured cells on a lattice settle into forms, the forms become organisms, the organisms group into tribes, and the tribes end up in hierarchies where some organisms rule others. Every so often a realm survives the death of its ruler, which is the point where I'd call it a government.

The rules only say what one organism does next to its neighbours. Each rung of the ladder is a measurement that notices when a new kind of order has shown up. It runs in your browser with no server behind it, and each world has a seed in the URL, so a link replays the same history for whoever opens it.

## The ladder

| Level | What runs | Reached when |
| --- | --- | --- |
| 1. Cells | 3D Life on a 48³ lattice: a dead cell with 7 or 8 live neighbours is born, a live cell with 1 to 5 survives. Newborns take the most common lineage around them. | 56 forms hold their shape for 20 generations |
| 2. Organisms | Each form that held becomes one body at the same spot, and the forms that didn't fade. Bodies eat from a food field that regrows, move, split when they're rich, and age. | The held forms become bodies |
| 3. Tribes | A newborn follows its parent. A ruler or a loner bows to a much stronger kin polity nearby, sooner when foreigners crowd it. | 3 kin groups of 12+ follow chiefs |
| 4. Hierarchy | Members of two polities that touch can fight. Local numbers decide, and a clear winner takes the loser (and everyone below it) as followers. Followers pay tribute upward and get fed when they starve. A lord manages 4 followers directly, so newcomers are handed down the tree. | One realm of 40+ rules 2 tribes through 5 ranks |
| 5. Government | A follower whose branch outgrows the rest of the realm may break away or take the throne. When a ruler dies, the strongest follower inherits, and the others stay only if the heir is clearly stronger. | A realm of 40+ outlives its ruler and keeps 60% of its members |

Levels can only be reached in order.

## Reading the picture

- The fill colour is the tribe (lineage) an organism was born into: Blue, Red, Gold, Green, Violet or Rose.
- A line runs from every follower up to its lord, in the colour of the ruler's tribe, so a Blue line on a Red organism means Blue rules it.
- Followers settle just below their lord. A realm hangs from its ruler like an upside-down tree, and siblings spread apart in proportion to the size of their branches.
- A ring marks a ruler, and bigger bodies have more organisms below them.
- The green stipple is food. It thins out where a realm grazes and grows back after.
- Hovering an organism traces its chain of command and shows its rank.

## Tuning without graphics

The simulation core in `src/sim` is plain TypeScript with no browser dependencies, so Node runs it directly (Node 22.18+ strips the types).

```bash
npm run world -- --seed cedar --ticks 6000
```

That prints one world's history as a chronicle, at 100 ticks to a year, with the ladder times and counts at the end. These lines are from that run:

```
y  5 *** Tribes: 3 kin groups now follow chiefs.
y 13     Pever conquers Vesa and its 29.
y 13 *** Hierarchy: Pever rules 3 tribes through 8 ranks.
y 13     Rebellion: 29 Gold subjects break away from Pever.
y 19 *** Government: Taul outlives its ruler, and the heir keeps 100% of 41.
y 23     Coup in Sada: a Green lord seizes the throne.
y 45     Tove overruns Kotopex and its 37.
```

```bash
npm run sweep -- --sets 160 --refine 72 --seeds 6 --ticks 12000
```

The sweep runs a random search over 32 parameters on worker threads, refines around the four best sets, and then checks the three finalists on 16 seeds it never trained on. Each run gets a score for whether every level arrives in order and not too early, how many major realms stand and how much of the population they hold, and whether some wars, rebellions and collapses happen along the way. The winner goes to `tuning/best.json` and the full table to `tuning/runs/`. The current defaults came out of this loop, which took about 10 minutes on 16 worker threads.

To watch a parameter file in the browser:

```bash
npm run url -- tuning/best.json --base http://localhost:5173
```

### How consistent it is

I checked the defaults on 32 seeds, 16 from the search and 16 it never saw, each run for 150 to 190 years. 31 of the 32 worlds reached all five levels. The median world had a multi-tribe hierarchy by year 20 to 38 and a government by year 29 to 80, with 10 to 11 major realms (15+ members) holding 70% of the population and 2 to 3 rebellions or coups per 10 years. The one miss (seed `s13`) had 25 conquests, but no realm ever held two tribes, 40 members and 5 ranks at the same time.

## Running it

```bash
npm install
npm run dev
```

`npm run build` writes a static site to `dist/`. It's Vite and Three.js with no server code, so Vercel serves it as plain files and a visit costs about 260 KB of transfer. Space pauses, `N` makes a new world, and `1` to `4` set the speed.

## Layout

- `src/sim/cells.ts` is the lattice and form tracking.
- `src/sim/society.ts` holds the organisms, polities, events and ladder checks.
- `src/sim/score.ts` turns a run into numbers and a score.
- `src/render/` has the voxel, sphere, line and food drawing.
- `src/ui/hud.ts` is the ladder, chronicle and readouts.
- `scripts/` holds the headless runner, sweep, rule search and URL helper.

The look follows `docs/taste/ciechanow.ski.md`: one paper ground, gray controls, a single 1.5px ink outline, and colour spent only on the organisms and the words that name them.

MIT licensed.
