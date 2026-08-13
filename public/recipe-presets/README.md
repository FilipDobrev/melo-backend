# Recipe Preset Placeholders

These are placeholder images for recipe presets. Each file is a 1200x800 SVG with the preset name centered for quick identification during development.

To add real images, drop a 1200x800 JPEG into this folder, then update the `filename` field for the corresponding preset in `backend/src/services/recipeImage.ts`.

These placeholder images are served by the API at `/static/recipe-presets/<filename>`.
