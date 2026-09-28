# Funtime Theater

A seat-finding arcade game set in a B-movie theater. Choose a show, catch the lit seat, and use your ticket earnings at the concession stand.

Originally part of [edconde.com](https://edconde.com); this is the standalone game. The lobby art, seat play, sounds, progression, and save data run in the browser. No account or server is involved.

## Run locally

```sh
npm ci
npm start
```

`npm run typecheck`, `npm run test:ci`, and `npm run build` check the production code, game logic, and build. The app uses Angular 21. Progress and sound settings are stored locally in your browser; clearing site data resets them.

## Design tools

`npm run simulate` exercises the ticket economy with the game's current constants. `npm run contact-sheet` renders film frames for visual review; install a Playwright Chromium browser (`npx playwright install chromium`) or point `CHROME_BIN` at a local Chrome binary.

## License

Application code is [MIT licensed](LICENSE). Bundled fonts have their own licenses beside the font files in `public/assets/fonts`. Font Awesome is installed through npm under its own license. Inline icon paths are covered by the [Phosphor Icons license](third_party/PHOSPHOR-LICENSE).
