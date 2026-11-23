(function () {
  const HL = window.HL;
  HL.Assets = {
    img: {},
    load(files, onProgress) {
      let done = 0;
      return Promise.all(files.map((f) => new Promise((res) => {
        const im = new Image();
        im.onload = () => { HL.Assets.img[f] = im; onProgress && onProgress(++done / files.length); res(); };
        im.onerror = () => { console.warn('missing image', f); onProgress && onProgress(++done / files.length); res(); };
        im.src = f;
      })));
    },
  };
})();
