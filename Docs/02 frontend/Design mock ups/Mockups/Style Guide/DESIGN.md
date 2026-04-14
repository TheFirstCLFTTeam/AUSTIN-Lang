# Design System Strategy: High-End Institutional Precision

## 1. Overview & Creative North Star
**Creative North Star: The Sovereign Architect**
This design system is engineered to project the same authority, precision, and heritage associated with Swiss institutional banking, adapted for a modern digital landscape. We move beyond generic fintech tropes by embracing **Institutional Brutalism**—a style characterized by heavy-weight typography, a strict "no-radius" policy (0px roundedness), and an unapologetic use of high-contrast black and red.

The system breaks the "template" look through **intentional asymmetry**. We lean into large-scale editorial layouts where typography acts as a structural element, not just content. By utilizing wide tracking in labels and condensed, authoritative headers, we create a digital experience that feels curated, bespoke, and permanent.

---

## 2. Colors: Tonal Depth & The "No-Line" Rule
The palette is rooted in the high-contrast tension between `on_surface` (UBS Black) and `secondary` (UBS Red), supported by a sophisticated range of anthracite greys.

*   **The "No-Line" Rule:** To maintain a premium, editorial feel, 1px solid borders are strictly prohibited for sectioning. Boundaries must be defined solely through background color shifts. For instance, a `surface_container_low` section should sit adjacent to a `surface` background to define its edge. 
*   **Surface Hierarchy & Nesting:** We treat the UI as a physical stack of fine paper. 
    *   Use `surface_container_lowest` (#ffffff) for active, high-priority cards.
    *   Place them atop `surface_container` (#ebeeef) for a soft, natural hierarchy.
*   **The "Glass & Gradient" Rule:** While the foundation is solid, secondary interactions (like floating navigation or modal overlays) should utilize glassmorphism. Use `surface_variant` at 80% opacity with a 20px backdrop blur to ensure the institutional weight feels breathable.
*   **Signature Textures:** Use a subtle linear gradient on main CTAs, transitioning from `secondary` (#c20000) to `secondary_dim` (#ab0100). This provides a "machine-finished" depth that a flat color cannot replicate.

---

## 3. Typography: The Editorial Authority
We use a dual-font strategy to balance modernity with institutional heritage.

*   **Display & Headlines (Manrope):** Chosen for its geometric precision. Use `display-lg` (3.5rem) with tight letter-spacing (-0.02em) to command attention. This is the "voice" of the brand—unwavering and clear.
*   **Body & Labels (Inter):** Chosen for maximum legibility in complex data environments. 
*   **Hierarchy as Identity:** Use `label-md` with 10% letter-spacing and uppercase styling for "overlines" or category tags. This mimics high-end print mastheads and elevates the content.

---

## 4. Elevation & Depth: Tonal Layering
In a system with **0px roundedness**, traditional shadows can look dated. We rely on **Tonal Layering**.

*   **The Layering Principle:** Depth is achieved by "stacking." A `surface_container_highest` element placed on a `surface_dim` background creates a clear visual lift without a single pixel of shadow.
*   **Ambient Shadows:** If a floating element (like a dropdown) requires separation, use an "Ambient Shadow": `box-shadow: 0 20px 40px rgba(0,0,0,0.06);`. This mimics soft, natural light rather than a digital effect.
*   **The "Ghost Border" Fallback:** For accessibility in form inputs, use a "Ghost Border"—the `outline_variant` token at 15% opacity. It provides a guide without breaking the "No-Line" aesthetic.

---

## 5. Components: Precision Primitive
All components must adhere to the **0px Roundedness Scale**—sharp corners are a non-negotiable signature of this system.

*   **Buttons:**
    *   *Primary:* Solid `on_surface` (UBS Black) with `surface` text. Rectangular, no radius.
    *   *Secondary:* Outlined with a 1px `on_primary_fixed` border. 
    *   *Interaction:* On hover, Primary buttons should transition to `secondary` (UBS Red) to provide a sharp, high-energy feedback loop.
*   **Input Fields:** Use a "Bottom-Line Only" approach or a solid `surface_container` fill. Forbid the 4-sided box where possible to maintain an open, modern feel.
*   **Cards & Lists:** Forbid the use of divider lines. Use the Spacing Scale (specifically `spacing.8` or 2rem) to create clear separation through whitespace.
*   **The Institutional "Audit" Component:** Given the brand's precision, incorporate "Data Tickers" or small-cap `label-sm` metadata strings at the bottom of cards to provide a sense of transparency and detail.

---

## 6. Do's and Don'ts

**Do:**
*   **Do** use the UBS Black (`#000000`) for the 'CLFT' logo and head icon to maintain visual gravity.
*   **Do** embrace white space. If a layout feels "crowded," double the current spacing token.
*   **Do** use asymmetrical grid layouts (e.g., a 4-column content block offset against an 8-column empty space).

**Don't:**
*   **Don't** use any border-radius. Every corner must be 0px to maintain the "Institutional" aesthetic.
*   **Don't** use generic blue for links or "Success" states. Use `tertiary` greys for neutral states and UBS Red for critical actions.
*   **Don't** use standard "drop shadows." If the tonal shift isn't enough, rethink the background layers.
*   **Don't** use icons with rounded terminals. Ensure all iconography is sharp, stroke-based, and matches the weight of the Inter typeface.