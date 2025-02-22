# Streamwall

:construction: Streamwall v2.0 is a work-in-progress :construction:

Goals for the v2 branch:

- TypeScript
- Use Electron Forge to distribute packaged releases
- Split out control server; refactor for local-only use without a webserver

---

Streamwall makes it easy to compose multiple livestreams into a mosaic, with source attributions and audio control.


## How it works

Under the hood, think of Streamwall as a specialized web browser for mosaicing video streams. It uses [Electron](https://www.electronjs.org) to create a grid of web browser views, loading the specified webpages into them. Once the page loads, Streamwall finds the `<video>` tag and reformats the page so that the video fills the space. This works for a wide variety of web pages without specialized scrapers.


## Configuration

Streamwall has a growing number of configuration options. To get a summary run:

```
npm start -- --help
```

For long-term installations, it's recommended to put your options into a configuration file. To use a config file, run:

```
npm start -- --config="../streamwall.toml"
```

See `example.config.toml` for an example.

## Data sources

Streamwall can load stream data from both JSON APIs and TOML files. Data sources can be specified in a config file (see `example.config.toml` for an example) or the command line:

```
npm start -- --data.json-url="https://your-site/api/streams.json" --data.toml-file="./streams.toml"
```

## Hotkeys

The following hotkeys are available with the "control" webpage focused:

- **alt+[1...9]**: Listen to the numbered stream
- **alt+shift+[1...9]**: Toggle blur on the numbered stream
- **alt+s**: Select the currently focused stream box to be swapped
- **alt+c**: Activate [Streamdelay](https://github.com/chromakode/streamdelay) censor mode
- **alt+shift+c**: Deactivate [Streamdelay](https://github.com/chromakode/streamdelay) censor mode
