# Streamwall

Streamwall makes it easy to compose multiple livestreams into a mosaic, with source attributions and audio control.

![Screenshot of Streamwall displaying a grid of streams](screenshot.png)

## How it works

Think of Streamwall as a specialized web browser for mosaicing video streams. It uses [Electron](https://www.electronjs.org) to create a grid of web browser views, loading the specified webpages into them. Once the page loads, Streamwall finds the `<video>` tag and reformats the page so that the video fills the space. This works for a wide variety of web pages without specialized scrapers.

## Installation

Download and install the latest release from the [Releases page](https://github.com/streamwall/streamwall/releases).

## Running Streamwall

1. Start the app by running the installed executable. When your browser opens, log into the control panel.
    - **Default username:** `admin`
    - **Default password:** `password`
1. Use the browser window to load or control streams.
1. If you enter the same stream code in multiple cells, it will merge them together for a larger stream.

## Configuration

Streamwall has a number of configuration options. See `example.config.toml` for an example.

TODO: Document all available options.
TODO: Document how to use the config file.

## Data sources

Streamwall can load stream data from both JSON APIs and TOML files. Data sources can be specified in a config file (see `example.config.toml` for an example) or the command line:

TODO: Document how to use the command line to specify data sources.
TODO: Document how to use the config file to specify data sources.

## Twitch bot

Streamwall can announce the name and URL of streams to your Twitch channel as you focus their audio. Use [twitchtokengenerator.com](https://twitchtokengenerator.com/?scope=chat:read+chat:edit) to generate an OAuth token. See `example.config.toml` for all available options.

## Hotkeys

The following hotkeys are available with the "control" webpage focused:

- **alt+[1...9]**: Listen to the numbered stream
- **alt+shift+[1...9]**: Toggle blur on the numbered stream
- **alt+s**: Select the currently focused stream box to be swapped
- **alt+c**: Activate [Streamdelay](https://github.com/chromakode/streamdelay) censor mode
- **alt+shift+c**: Deactivate [Streamdelay](https://github.com/chromakode/streamdelay) censor mode

## Troubleshooting

### The Streamwall window only fits 2.5 tiles wide

Streamwall in its default settings needs enough screen space to display a 1920x1080 (1080p) window, with room for the titlebar. You can configure Streamwall to open a smaller window:

TODO: Document how to configure the window size.

## Credits

SVG Icons are from Font Awesome by Dave Gandy - http://fontawesome.io
