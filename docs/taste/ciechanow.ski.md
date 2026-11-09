# Design Map

## Spacing Scale
- Base unit: none in px; spacing is em multiples of the local font size
- 7.2px: section heading bottom padding (0.25em of 28.8px)
- 13.44px: paragraph padding top and bottom (0.7em of 19.2px); 26.88px between paragraphs
- 21.6px: section heading top padding (0.75em of 28.8px)
- 24px: nav link right padding
- 25px: slider zone padding above and below the 4px track (50px zone)
- 32px: margin below each figure
- 34.08px / 22.72px: equation padding, vertical / horizontal (1.5em / 1em), with -11.36px margins
- 36.8px: margin above each figure
- 48px: article top margin, column side padding, article bottom padding

## Font Hierarchy
- 44.8px Inter 600, #F8F8F8: site title on the banner
- 38.4px Inter 600, #535353: post title (padding 15.36px top, 9.6px bottom)
- 32.48px IBM Plex Sans 400, #333333: large canvas readouts ("90°/s", "0.5π rad/s")
- 28.8px Inter 600, #535353: section headings
- 22.72px IBM Plex Sans 500, #444444, line-height 40.9px (1.8): display equations with a 2px #444444 fraction bar
- 20px IBM Plex Sans 500, #444444, line-height 36px: segmented control labels
- 19.2px IBM Plex Sans 400, #444444, line-height 30.72px (1.6): body, about 70 characters per 704px line
- 19px IBM Plex Sans 400, #000000 or #333333: canvas labels and readouts ("30.0 rpm", "pitch circle")
- 17.4px to 19px IBM Plex Sans 500, #333333: canvas variable glyphs (F, r, V), scaled with figure size
- 16px IBM Plex Sans 400: nav (#F8F8F8 on the banner), post date (#AAAAAA)
- 14.4px IBM Plex Sans 400, #CCCCCC: footer
- 13.632px IBM Plex Sans 500: equation subscripts
- 11px to 11.5px IBM Plex Sans 500, #333333: canvas subscripts
- Weights in use: 400, 500, 600
- Fallback stack: "Helvetica Neue", Arial, sans-serif

## Color Palette
- #F8F8F8: page ground, banner text, selected segment
- #2052BB: banner (1440 x 171px), the only colored surface outside figures
- #444444: body text, equation bars, segmented labels
- #535353: post title and section headings
- #AAAAAA: post date
- #CCCCCC: footer
- #0181EB: outbound links, underline 1.152px at 1.92px offset
- #CA9839: links that change a figure (link_button), same underline
- #555555: figure outlines and arrow glyphs
- #888888: gear hubs
- #FCD561, #D45E5E, #5EAAD4, #78AD6C: figure body fills (yellow, red, blue, green)
- #DDDDDD: neutral figure parts (fan blades), segmented trough
- #1F6AEA, #EB2D2D, #39C085, #F74D4D, #E03232: emphasis strokes and matching inline color words
- #B71262, #6F12B7, #1220B7, #1270B7, #12B7A5, #2CB712: point-sequence dots
- #333333 and #000000: canvas text
- #777777: slider knob and filled track; unfilled track #777777 at 0.2 opacity
- rgba(0,0,0,0.05): pause button ground
- Neutrals: pure gray (R=G=B), no hue tint

## Image Ratios
- Raster images: none; all 30 figures are 2D canvas (0 WebGL) on a transparent ground
- 2:1 (704 x 352) and 4:3 (704 x 528): full-measure figures
- 1.85:1 (500 x 270): opening gear train
- 1:1 (280 x 280, 350 x 350): single objects
- 0.95:1 (350 x 368) and 0.71:1 (250 x 350): upright objects
- Width range 250px to 704px, centered in the column

## Component Tokens
- Radius: 2px slider track, 6px pause button, 7px segment pill, 10px segmented trough, 20px knob (40px circle), 0px figures
- Shadows: none
- Grid: 1 column; 800px wrapper with 48px side padding gives a 704px measure, centered; 0 CSS grids
- Banner: #2052BB, 171px tall, 11.2px bottom padding; title left edge at x=368 (the column edge); social icons 34px at opacity 0.75
- Figure block: drawer_container > canvas_container > canvas; no frame; 36.8px above, 32px below
- Slider: 380px wide; 4px track, 2px radius, #777777 filled, #777777 at 0.2 unfilled; 40px #777777 knob, 20px radius, cursor grab; 25px padding above and below
- Pause button: 44 x 44px, rgba(0,0,0,0.05), 6px radius, dark glyph sprite, pinned to the canvas bottom-left (left 0, bottom 0)
- Segmented control: 500 x 40px #DDDDDD trough, 10px radius; selected pill 164 x 36px #F8F8F8, 7px radius, 2px inset; labels 20px/500 centered; no shadow
- Equation: centered, 22.72px/500, 2px #444444 fraction bar, 34.08px vertical padding
- Canvas strokes: 1.5px #555555 outlines (2,349 sampled calls), 0.5px #555555 hairlines, 4px #555555 heavy lines, 2.5px to 3px emphasis colors
- Canvas label states: active at alpha 1.0, inactive at alpha 0.08; inactive circles at 0.2
- Motion: 18 of 30 figures autoplay; CSS transitions color 0.15s (links) and opacity 0.15s (icons); one inline "globally pause" link
- Accessibility facts: no :focus-visible rules, no prefers-reduced-motion rules; figure nodes carry .non_selectable

---

# Taste DNA

### Frameless figures
- **Trigger**: When the designer placed 30 interactive canvases, 250 to 704px wide, in a 33,356px essay
- **Decision**: Chose transparent canvases drawn straight onto the #F8F8F8 page ground, with no border, fill, radius or shadow, over framed figure panels (a tinted card with a border or drop shadow)
- **Reason**: A frame tells readers they've entered a separate widget. A gear drawn on the same paper as the sentence above it reads as the thing that sentence describes, so readers keep following the argument as they scroll into a figure.
- **Evidence**: 30 of 30 canvas containers have a transparent background, 0px border and 0px radius; the first canvas is 44.5% fully transparent pixels; the page has 0 box-shadows and 0 card containers; figures are separated only by a 36.8px margin above and 32px below

### Gray controls, colored subjects
- **Trigger**: When the simulations needed controls (26 sliders, 18 pause buttons, 1 segmented switch)
- **Decision**: Chose flat neutral controls (a 4px #777777 track whose unfilled side drops to 0.2 opacity, a 40px round #777777 knob, a 44px pause square at 5% black, a #DDDDDD segmented trough holding a page-colored pill) over sliders and buttons in the brand blue or a hue per control, with borders and shadows
- **Reason**: Eyes go to saturated color first. When every control is gray, a reader dragging the knob watches the mechanism respond and sees the control only at the edge of their vision.
- **Evidence**: slider track 4px at 2px radius with a 40px knob at 20px radius, x26; pause 44 x 44px at rgba(0,0,0,0.05) and 6px radius, pinned to the canvas bottom-left, x18; segmented trough 500 x 40px #DDDDDD at 10px radius with a 164 x 36px #F8F8F8 pill at 7px radius; no control uses #2052BB, #0181EB or a figure hue; knob contrast 4.2:1 on #F8F8F8

### One outline, saturated emphasis strokes
- **Trigger**: When the designer drew dozens of different mechanisms (gears, fans, discs, involute curves) for one article
- **Decision**: Chose one 1.5px #555555 outline around light tinted fills (#FCD561, #D45E5E, #5EAAD4, #78AD6C at HSL lightness 55 to 68%), with deeper 2.5 to 3px strokes kept for the path or vector under discussion (#1F6AEA and #EB2D2D at 83% saturation against 58% for the blue and red fills), over a new palette per figure or fully saturated bodies
- **Reason**: When every body shares an outline and a similar lightness, readers stop comparing drawing styles and compare only what changes, such as speed or direction. The one saturated stroke then reads as the quantity to watch, with no caption needed.
- **Evidence**: 2,349 sampled stroke calls at 1.5px #555555 vs 160 each at 3px #1F6AEA and #EB2D2D; fill calls #78AD6C 1234, #FCD561 921, #5EAAD4 432, #D45E5E 138; every gear hub is #888888; red body fill #D45E5E is 58% HSL saturation while the red emphasis stroke #EB2D2D is 83%

### Text is the legend
- **Trigger**: When a figure had to tell readers which colored line or point is which
- **Decision**: Chose to name each color inside the running prose in that stroke's exact hex at weight 500, and to keep in-canvas text to unboxed 19px IBM Plex Sans readouts whose state changes by opacity (1.0 active, 0.08 inactive), over legend boxes or hover tooltips inside the figure
- **Reason**: Readers are reading the sentence while they watch the drawing, so a key inside the sentence saves a look-away. A label that fades in place keeps the figure still while its state changes.
- **Evidence**: inline color words #EB2D2D, #1F6AEA, #39C085, #F74D4D, #E03232 at weight 500 match canvas stroke and fill hex; 7 gold #CA9839 link_button phrases ("dedendum circle", "globally pause") change figure state; canvas labels are 19px IBM Plex Sans #000000 or #333333 with inactive copies at globalAlpha 0.08; 0 bordered labels or legend panels across 30 figures
