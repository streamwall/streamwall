# Streamwall

> [!NOTE]
> Streamwall was originally made for the George Floyd protests in 2020. Streamwall has been used to share the details of local, national, and global sociopilitial events in real-time
>
> Please use it morally, ethically, and responsibly, credit and communicate with your sources, and act in accordance with the laws of your jurisdiction

Streamwall is a web browser that displays a grid of video streams with audio control and source attribution for livestreaming and archival purposes. Streamwall works with [OBS](https://obsproject.com/), [XSplit](https://www.xsplit.com/), and other streaming software that can display custom browsers and application windows

Streamwall is primarily designed for use in livestreaming situations that involve multiple video sources across video-based social media hosts across the internet. Streamwall can be used to create a grid of video streams, each with its own audio control, and can be used to display a variety of video sources. Streamwall includes plugins for the following platforms, and supports many more:

- Twitch
- YouTube
- Facebook
- Periscope
- Instagram
- TikTok
- Custom browser sources and websites

## Installation

Download and install the latest release for your system from the [Releases page](https://github.com/streamwall/streamwall/releases)

- The latest stable build is always available on the [Releases page](https://github.com/streamwall/streamwall/releases) or `release` branch of this repository
- The latest development build is available on the `main` branch of this repository

## Media

![Screenshot of Streamwall displaying a grid of streams](screenshot.png)

## How it works

Streamwall is a specialized web browser designed to display and manage grids of video streams.

Streamwall uses [Electron](https://www.electronjs.org) to arrange a grid of web browser views, load the specified video source(s), and produce a CCTV-esque composition for the sake of rebroadcasting. Streamwall is built and distribued with [Electron Forge](https://www.electronforge.io/)

For each live video, Streamwall creates a separate browser, finds the `<video>` tag in its web page, and reformats the page so that the video fills the space. This works for a wide variety of web pages and platforms without the need for specialized scrapers (with exception)

## How to run Streamwall

> [!TIP]
>
> The first time you run Streamwall, it will open a browser window and ask you to login. Here are the default credentials:
> - **Default username:** `admin`
> - **Default password:** `password`

1. Start the app by running the installed executable. When your browser opens, log into the control panel
1. Use the browser window to load or control streams.
1. If you enter the same stream code in multiple cells, it will merge them together for a larger stream

## Configuration

Streamwall has a number of configuration options. See `example.config.toml` for an example

### Configuration file

Streamwall can load configuration from a TOML file by starting streamwall with the `--config=config.toml` option (relative path to the executable).  When setting values in your configuration file, you can use the following format where the prefix represents the category of the configuration:

```toml
[control]
address = "http://localhost:80"

[data]
interval = 30
```

### Command line options

Streamwall can also accept configuration options via the command line. For example, to set the control panel address:

```sh
streamwall --control.address="http://localhost:80"
```

### Available configuration options

| Option | Description | Default | Example | Accepted Values |
|--------|-------------|---------|---------|-----------------|
| `cert.dir` | The directory to store SSL certificates for HTTPS | Not set | `"./certs"` | Any valid directory path |
| `cert.email` | The email address for the SSL certificate owner | Not set | `"admin@example.com"` | Any valid email address |
| `cert.production` | Whether to obtain a real SSL certificate (true) or use a test one (false) | `false` | `true` | `true` or `false` |
| `control.address` | The full URL where the control panel will be accessible | `"http://localhost:80"` | `"https://myapp.com"` | Any valid URL |
| `control.hostname` | Override the hostname for the control panel (use with `control.port`) | Not set | `"localhost"` | Any valid hostname |
| `control.open` | Automatically open the control website in a browser after launching | `true` | `false` | `true` or `false` |
| `control.password` | The password required to access the control panel | Not set | `"securepass123"` | Any string |
| `control.port` | Override the port for the control panel (use with `control.hostname`) | Not set | `8080` | Any valid port number |
| `control.username` | The username required to access the control panel | Not set | `"admin"` | Any string |
| `data.interval` | The interval in seconds to refresh polled data sources | `30` | `60` | Any positive integer |
| `data.json-url` | A list of JSON API URLs to load stream sources from | `[]` | `["https://api.example.com/streams"]` | Any list of valid URLs |
| `data.toml-file` | A list of local TOML files to load stream sources from | `[]` | `["./streams.toml"]` | Any list of valid file paths |
| `grid.count` | The number of grid cells to display in the window | `3` | `4` | Any positive integer |
| `streamdelay.endpoint` | The URL of the Streamdelay service endpoint | `"http://localhost:8404"` | `"https://delay.myapp.com"` | Any valid URL |
| `streamdelay.key` | The API key for authenticating with the Streamdelay service | Not set | `"abc123xyz789"` | Any string |
| `telemetry.sentry` | Enable or disable error reporting to Sentry | `true` | `false` | `true` or `false` |
| `twitch.announce.delay` | Time to wait (in seconds) before announcing stream details | `30` | `15` | Any positive integer |
| `twitch.announce.interval` | Minimum time (in seconds) between re-announcing the same stream | `60` | `120` | Any positive integer |
| `twitch.announce.template` | The message template for stream announcements in chat | See code | `"Now streaming: <%- stream.title %>"` | Any valid template string |
| `twitch.channel` | The Twitch channel to connect to for chat interactions | Not set | `"mychannel"` | Any valid Twitch channel name |
| `twitch.color` | The color of the Twitch bot's username in chat | `"#ff0000"` | `"#00ff00"` | Any valid CSS color value |
| `twitch.password` | The OAuth token for the Twitch bot account | Not set | `"oauth:abc123..."` | Valid Twitch OAuth token |
| `twitch.username` | The Twitch username for the bot account | Not set | `"mybot"` | Any valid Twitch username |
| `twitch.vote.interval` | Time interval (in seconds) between votes (0 to disable voting) | `0` | `300` | Any non-negative integer |
| `twitch.vote.template` | The message template for vote result announcements | See code | `"Stream <%- selectedIdx %> won with <%- voteCount %> votes!"` | Any valid template string |
| `window.active-color` | The highlight color for active elements in the window | `"#fff"` | `"#ff0000"` | Any valid CSS color value |
| `window.background-color` | The background color of the window, useful for chroma-keying | `"#000"` | `"#00ff00"` | Any valid CSS color value |
| `window.frameless` | Creates a window without borders or title bar if set to true | `false` | `true` | `true` or `false` |
| `window.height` | The height of the application window in pixels | `1080` | `720` | Any positive integer |
| `window.width` | The width of the application window in pixels | `1920` | `1280` | Any positive integer |
| `window.x` | The x-coordinate of the window position on the screen | Not set | `100` | Any integer |
| `window.y` | The y-coordinate of the window position on the screen | Not set | `50` | Any integer |

## Data sources

Streamwall can load stream data from both JSON APIs and TOML files. Data sources can be specified in a config file (see `example.config.toml` for an example) or the command line

### Example: CLI command to specify data sources

```sh
streamwall --data.json-url="https://api.example.com/streams"
```

and/or


```sh
streamwall --data.toml-file="./streams.toml"
```

### Example: Config file to specify data sources

```toml
[data]
json-url = ["https://api.example.com/streams"]
toml-file = ["./streams.toml"]
```

## Twitch bot

Streamwall can announce the name and URL of streams to your Twitch channel as you focus their audio. Use [twitchtokengenerator.com](https://twitchtokengenerator.com/?scope=chat:read+chat:edit) to generate an OAuth token. See `example.config.toml` for all available options

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

> Create a `config.toml` file with the following content:
>
>    ```toml
>    [window]
>    width = 1280
>    height = 720
>    ```

## Development

### Getting started

1. Clone the repository
1. Install dependencies with `npm install`
1. Run the app with `npm start`
1. Read `package.json` for more scripts you can run

### Building

1. Run `npm run make` to build the app for your current platform
1. The built app will be in the `dist` directory

### Testing

1. Run `npm test` to run the test suite. Alternatively, you can run the ci suite with `npm run test:ci`
1. Please manually test the app as thoroughly as possible before opening a pull request

### Contributing

1. Fork the repository
1. Create a new branch
1. Make your changes
1. Run the test suite
1. Create a pull request

### Versioning

Streamwall uses [Semantic Versioning](https://semver.org/).

To release a new version:

1. Update the version number in `package.json`
1. Run `npm run publish` to create new distributables
1. Create a new release on GitHub with the new version number

## Credits

### Contributors

- @chromakode - Original author & primary maintainer
- @sayhiben - Current maintainer

### Libraries & Resources

- SVG Icons are from Font Awesome by Dave Gandy - http://fontawesome.io
