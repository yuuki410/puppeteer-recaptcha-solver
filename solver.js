const axios = require('axios');
const { fstat, writeFileSync, readFileSync } = require('fs');
const https = require('https');
const got = require('got');

function rdn(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min)) + min;
}

async function dumpFrameTree(frame, indent) {
  const name = await frame.title();
  const url = frame.url();
  console.log(indent + `${name}: ${url}`);
  for (const child of frame.childFrames()) {
    await dumpFrameTree(child, indent + '  ');
  }
}

const TWO_DAYS_IN_MILLISECONDS = 172800000;

const twoDaysAgo = () => {
  const date = new Date(Date.now() - TWO_DAYS_IN_MILLISECONDS);
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();

  return `${y}${m}${d}`;
};

async function solve(page, browser) {
  try {
    // Wait until we have the frame we want
    while (true) {
      console.log('looking for a recaptcha');
      const iframe = await page.waitForFunction(() => {
        const found = document.querySelector('iframe[src*="api2/anchor"]');
        // return !!iframe.contentWindow.document.querySelector('#recaptcha-anchor');
        return found;
      });

      if (iframe) {
        console.log('found recaptcha');
        break;
      }
      console.error('Nothing found');
      page.waitForTimeout(250);
      continue;
    }

    console.log('Getting frames.');
    let frames = await page.frames();

    console.log('Finding recaptcha');
    const recaptchaFrame = frames.find((frame) =>
      frame.url().includes('api2/anchor'),
    );

    console.log('Finding recaptcha checkbox');
    const checkbox = await recaptchaFrame.waitForSelector('#recaptcha-anchor');

    console.log('Clicking recaptcha checkbox');
    await checkbox.click({ delay: rdn(30, 150) });

    await page.waitForTimeout(750);

    console.log('Just for shits and giggles, lets check if we have succeeded');
    const checkboxNow = await recaptchaFrame.$eval(
      '#recaptcha-anchor',
      (el) => el.outerHTML,
    );
    // console.log(checkboxNow, '');

    // console.log('Checking recaptcha images exist');
    // await recaptchaFrame.$eval('.rc-image-tile-wrapper img', (frame) =>
    //   console.log(frame.innerHTML),
    // );
    // console.log('Find the image');
    {
      // try {
      //   const found = await recaptchaFrame.waitForSelector('.rc-image-tile-wrapper img');
      //   if (!found) {
      //     throw new Error('');
      //   }
      // } catch (error) {
      //   console.warn(`Finding image failed`);
      //   await page.waitForTimeout(1000);
      // }
    }
    if(await recaptchaFrame.$('.rc-image-tile-wrapper img')){
      await recaptchaFrame.$eval(
        '.rc-image-tile-wrapper img',
        (img) => img.complete,
      );
      console.log('Found the image');
    }
    console.log('Getting a new frames array');
    frames = await page.frames();

    console.log('Finding recaptcha image iframe');
    const imageFrame = frames.find((frame) =>
      frame.url().includes('api2/bframe'),
    );

    const foundFrames = frames.filter((frame) =>
      frame.url().includes('api2/bframe'),
    );
    console.log(
      `Found ${foundFrames.length} frames with url a url containing 'api2/bframe'`,
    );

    const imgHTML = await imageFrame.$eval('body', (el) => el.outerHTML);
    // console.log(imgHTML);

    console.log('Finding audio button');
    const audioButton = await imageFrame.waitForSelector('#recaptcha-audio-button');

    console.log('Clicking audio button');
    await audioButton.click({ delay: rdn(30, 150) });

    while (true) {
      await imageFrame.waitForSelector('#audio-source')
      // await page.waitForTimeout(4*1000);

      try {
        console.log('Finding Download link');
        await page.waitForFunction(
          () => {
            const iframe = document.querySelector('iframe[src*="api2/bframe"]');
            if (!iframe) return false;

            return !!iframe.contentWindow.document.querySelector(
              '#audio-source',
            );
          },
          { timeout: 1000 },
        );
      } catch (error) {
        console.error('download link not found');
        return null;
      }

      console.log('Getting the src of the audio src');
      const audioLink = await page.evaluate(() => {
        const iframe = document.querySelector('iframe[src*="api2/bframe"]');
        return iframe.contentWindow.document.querySelector('#audio-source').src;
      });

      console.log('Download audio');
      const audioBuffer = await got.get(audioLink);
      // const audioBytes = await page.evaluate((audioLink) => {
      //   return (async () => {
      //     const response = await window.fetch(audioLink);
      //     const buffer = await response.arrayBuffer();
      //     return Array.from(new Uint8Array(buffer));
      //   })();
      // }, audioLink);

      await writeFileSync('payload.mp3', audioBuffer.rawBody);

      var response = {
        data: {
          text: undefined
        }
      };

      while(true){

      let tmpPage = await browser.newPage();

      await tmpPage.goto('https://speech-to-text-demo.ng.bluemix.net/', {timeout: 0, waitUntil: 'networkidle2'});

      console.log('Sending api request');
      let fileInput = await tmpPage.$('input[type="file"]');
      await fileInput.uploadFile('payload.mp3');

      await tmpPage.waitForTimeout(15*1000);

      response.data.text = await tmpPage.$eval('div[data-id="Text"] div', e=>e.textContent);
      
      await tmpPage.close();
      
      if(response.data.text && response.data.text.length){
        break;
      }else{
        await page.waitForTimeout(4*1000);
      }

      }

      // const httsAgent = new https.Agent({ rejectUnauthorized: false });
      // const response = await axios({
      //   httsAgent,
      //   method: 'post',
      //   url: `https://api.wit.ai/speech?v=${twoDaysAgo()}`,
      //   data: new Uint8Array(audioBytes).buffer,
      //   headers: {
      //     Authorization: 'Bearer BJ6GUEOB2MPSPCR5FR3QM6JKIIVHILKC',
      //     'Content-Type': 'audio/mpeg3',
      //   },
      // });

      if (undefined == response.data.text) {
        console.log('Handling an empty response by reloading');
        const reloadButton = await imageFrame.$('#recaptcha-reload-button');
        await reloadButton.click({ delay: rdn(30, 150) });
        continue;
      }

      console.log('Extracting the text from response');
      const audioTranscript = response.data.text.trim();
      console.log('Text: '+ audioTranscript);
      console.log('findind the response input field');
      const input = await imageFrame.$('#audio-response');

      console.log('Selecting the input field');
      await input.click({ delay: rdn(30, 150) });

      console.log('Typing the response into the input field');
      await input.type(audioTranscript, { delay: rdn(30, 75) });

      console.log('Finding the submit button');
      const verifyButton = await imageFrame.$('#recaptcha-verify-button');

      console.log('Clicking the submit button');
      await verifyButton.click({ delay: rdn(30, 150) });

      await page.waitForTimeout(4*1000);

      try {
        console.log('Trying to confirm that it worked');
        await page.waitForFunction(
          () => {
            const iframe = document.querySelector('iframe[src*="api2/anchor"]');
            if (!iframe) return false;

            return !!iframe.contentWindow.document.querySelector(
              '#recaptcha-anchor[aria-checked="true"]',
            );
          },
          { timeout: 1000 },
        );

        return page.evaluate(
          () => document.getElementById('g-recaptcha-response').value,
        );
      } catch (e) {
        console.error('multiple audio');
        continue;
      }
    }
  } catch (e) {
    console.error(e);
    throw e;
  }
}

module.exports = solve;
