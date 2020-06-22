# Streamwall

:construction: Early WIP release! :construction:

Streamwall makes it easy to compose multiple livestreams into a mosaic, with source attributions and audio control.

![Screenshot of Streamwall displaying a grid of streams](screenshot.png)


## How it works

Under the hood, think of Streamwall as a specialized web browser for mosaicing video streams. It uses [Electron](https://www.electronjs.org) to create a grid of web browser views, loading the specified webpages into them. Once the page loads, Streamwall finds the `<video>` tag and reformats the page so that the video fills the space. This works for a wide variety of web pages without specialized scrapers.


## Setup

`git clone https://github.com/chromakode/streamwall.git && cd streamwall && npm install && npm start`



## Credits

SVG Icons are from Font Awesome by Dave Gandy - http://fontawesome.io
