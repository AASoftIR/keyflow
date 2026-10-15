# Keyflow 2.2.0 runtime fix

## Root cause: Persian was being shaped as separate DOM fragments

The previous engine rendered every grapheme inside its own `<span class="glyph">`. Persian and Arabic are contextual cursive scripts: glyph form and joining depend on neighboring characters in the same shaping run. WebKitGTK could therefore render isolated letter forms even though the underlying Unicode text was correct.

The fix is architectural rather than cosmetic: the passage is one uninterrupted text node. Typing colors are applied through CSS Custom Highlights, with Range-based marker geometry as a fallback. This preserves joining, ligatures, bidi ordering, and the original grapheme index model simultaneously.

## Sound now coaches

Correct key, word boundary, error, and completion each use a different Cuelume recipe. A visible Audio Coach button in the practice card plays the sequence on demand, and Settings still provides a dedicated sound test.
