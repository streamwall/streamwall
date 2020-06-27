# Streamwall

:construction: Early WIP release! :construction:

Streamwall makes it easy to compose multiple livestreams into a mosaic, with source attributions and audio control.

![Screenshot of Streamwall displaying a grid of streams](screenshot.png)


## How it works

Under the hood, think of Streamwall as a specialized web browser for mosaicing video streams. It uses [Electron](https://www.electronjs.org) to create a grid of web browser views, loading the specified webpages into them. Once the page loads, Streamwall finds the `<video>` tag and reformats the page so that the video fills the space. This works for a wide variety of web pages without specialized scrapers.

## Prerequisites

1. Node.js and npm. Download the LTS release from here - https://nodejs.org/en/

## Setup

1. Download streamwall. You can use git, or download and unzip https://github.com/chromakode/streamwall/archive/main.zip
2. Open the streamwall directory in a console
    - In Windows, the LTS install from nodejs.org will install a program called "Node.js command prompt." Open this program; Command Prompt and Powershell may not have the correct environment variables. Once it's open, change directories to where you extracted the file, e.g., `> cd c:\Users\<myname>\Downloads\streamwall\`
    - On MacOS, you should be able to use the default system terminal or other terminals like iTerm2 as long as a sufficient version of Node is installed. With that open, change directories to where you extracted the file, e.g., `> cd ~/Downloads/streamwall`
3. Run the following command: `npm install`

## To Start Streamwall

1. Using a terminal/console window as described above, go to the streamwall directory, and run `npm run start-local`
2. This will open a black stream window and a browser window. The default username and password are 'woke'.
3. Use the browser window to load or control streams. The initial list will be populated from https://woke.net/#streams
4. If you enter the same stream code in multiple cells, it will merge them together for a larger stream.

## Troubleshooting

### Unexpected token errors during `npm install`
We've observed this occur in cases where file corruption is an issue. The fix has been to clear the npm cache, remove the streamwall directory, and start from scratch.

### The Streamwall Electron window only fits 2.5 tiles wide
It's possible that your system resolution is causing a problem. If you only broadcast at 720p, you can update the height and width in `src/constants.js` to 1280 and 720 respectively. Save your changes and restart Streamwall

## Credits

SVG Icons are from Font Awesome by Dave Gandy - http://fontawesome.io
