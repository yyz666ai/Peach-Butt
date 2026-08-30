# Product Design QA — 桃桃小屋

final result: passed

## Evidence

- Visual source for this responsive repair: `/var/folders/4f/fh1kxjb14gldyxx4wqlg9pcc0000gn/T/codex-clipboard-a522c30c-31d2-44be-aef2-2df86e53d64a.png`
- Implementation screenshot: `docs/qa/dashboard-final.png`
- Side-by-side comparison: `docs/qa/dashboard-comparison.png`
- Responsive matrix: `docs/qa/dashboard-responsive-matrix.png`
- Tested dashboard viewports: `960 × 650`, `1050 × 760`, and `1400 × 800` logical pixels on macOS high-DPI display
- Explosion contact sheet: `docs/qa/explosion-contact-sheet.png`
- Idle motion contact sheet: `docs/qa/idle-motion-contact-sheet.png`
- Eye-strain contact sheet: `docs/qa/eye-strain-contact-sheet.png`
- Brightened video/cutout review: `docs/qa/video-brightness-and-cutout.png`
- Final one-line bubble: `docs/qa/pet-bubble-final.png`
- Same hover after 4 seconds: `docs/qa/pet-bubble-auto-hidden.png`
- Monthly calendar at `1050 × 760`: `docs/qa/dashboard-month-1050.png`
- Monthly calendar at `960 × 650`: `docs/qa/dashboard-month-960.png`
- Latest reference/month-calendar comparison: `docs/qa/month-dashboard-reference-comparison.png`

## Comparison history

1. Initial implementation was too dim, used small type, allowed story text to overflow its note, and gave the working character too much continuous motion.
2. Revised implementation raised peach/coral saturation and brightness, enlarged the type hierarchy, restored safe margins, separated energy/summary/growth/action zones, and changed the story note into a fixed entry that opens a stable dialog.
3. Final motion behavior plays the dashboard character once on entry, freezes on a stable frame, and replays once on hover. Video and still containers share a fixed visual slot.
4. Responsive repair replaced independently positioned major regions with one parent CSS grid. The energy title, score, summary, metrics, chart, action dock, character, and timer now occupy explicit rows or grid areas.
5. Final repair removed the fixed CSS minimum viewport that exceeded the framed Electron content height, made the chart parent resize with the window, and reserved a clipped 24px label row inside every habit button.
6. This pass centered the story copy inside its paper safe area and centered the growth title on its responsive card; both `960 × 650` and `1050 × 760` screenshots show separated energy title, score, summary, metrics, chart and dock.
7. Desktop-pet motion now uses a calm generated idle loop and a progressive eye-strain warning; generated-frame Alpha was tightened and white-matte color removed, while the greeting cutout was checked against a warm desktop background after brightening and foot-shadow cleanup.
8. The statistics-only revision removed the daily-story and timer blocks, converted the action dock to four equal columns, and added an in-card 7-day/current-month toggle. The month view keeps seven columns at both minimum and default window sizes and exposes per-day health detail without opening another page.

## Final checks

- P0: none.
- P1: none.
- P2: native system font differs from the lettering rendered inside the generated reference; accepted because it remains readable and consistent across macOS and Windows.
- All visible controls in the main journey have an action.
- Dynamic copy is constrained to a fixed dialog rather than laid directly over a variable-size generated note.
- Peach, energy arc, timer, and behavior objects remain visually dominant over the room background.
- No dashboard text visibly crosses its container boundary at any of the three recorded viewport sizes.
- The energy title no longer intersects the leaf/arc asset; the score and summary occupy separate alignment positions.
- The seven-day line and peach nodes reflow with the chart container at every recorded width.
- Habit names remain inside the dock even when the viewport is wide or at its minimum height.
- Reference and implementation were inspected together in the side-by-side comparison image.
- The current-month view was inspected at both `1050 × 760` and the enforced `960 × 650` minimum. All 35/42 date cells, the four behavior markers, selected-day detail and four-item action dock remain inside their containers.
- The speech bubble contains one short sentence, leaves the full body and feet visible, and disappears while the pointer remains over the pet.
