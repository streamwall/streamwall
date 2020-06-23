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
2. Using a terminal/console window, go to the streamwall directory and install the dependencies: `npm install`

## To Start Streamwall

1. Using a terminal/console window, go to the streamwall directory and run `npm run start-local`
2. This will open a black stream window and a browser window. The default username and password are 'woke'.
3. Use the browser window to load or control streams. The initial list will be populated from https://woke.net/#streams
4. If you enter the same stream code in multiple cells, it will merge them together for a larger stream.

## Credits

SVG Icons are from Font Awesome by Dave Gandy - http://fontawesome.io
