Y_lm is the canonical symbol of spherical harmonics.

The demo uses drum harmonics to visualize sound:

1. Sound samples get transformed with FFT.
2. Each frequency maps to a unique color.
3. Harmonics H(0)..H(K) of the base frequency are extracted.
4. The 0..K harmonics are mapped to 2D drum eigenfunctions
   using the same order as electron shells:
   - https://en.wikipedia.org/wiki/Vibrations_of_a_circular_membrane
   - https://en.wikipedia.org/wiki/Hydrogen-like_atom
5. The eigenfunctions get added together, multiplied by
   the energy levels given by harmonics.
