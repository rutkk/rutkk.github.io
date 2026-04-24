import { initScene } from './scene.js';

document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const isPosterCapture = params.get('capture') === 'poster';

  if (isPosterCapture) {
    document.documentElement.dataset.capture = 'poster';
  }

  const container = document.getElementById('canvas-container');

  if (isPosterCapture) {
    container.querySelector('.card-poster')?.remove();
  }

  const sceneAPI = initScene(container);

  window.addEventListener('resize', () => {
    sceneAPI.onResize();
  });
});
