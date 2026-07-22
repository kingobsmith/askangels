document.addEventListener('DOMContentLoaded', function () {
  var toggle = document.querySelector('.nav-toggle');
  var links = document.querySelector('.nav-links');
  if (toggle && links) {
    toggle.addEventListener('click', function () {
      links.classList.toggle('open');
    });
  }

  var prophecyBtn = document.getElementById('prophecy-play');
  var prophecyAudio = document.getElementById('prophecy-audio');
  var prophecyStatus = document.getElementById('prophecy-status');

  if (prophecyBtn && prophecyAudio) {
    prophecyBtn.addEventListener('click', function () {
      if (prophecyAudio.paused) {
        prophecyAudio.play().then(function () {
          prophecyBtn.textContent = 'Pause';
          prophecyBtn.classList.add('playing');
          if (prophecyStatus) prophecyStatus.textContent = 'Now playing: The Prophecy';
        }).catch(function () {
          if (prophecyStatus) prophecyStatus.textContent = 'Add audio/prophecy.mp3 to enable playback.';
        });
      } else {
        prophecyAudio.pause();
        prophecyBtn.textContent = 'Play';
        prophecyBtn.classList.remove('playing');
        if (prophecyStatus) prophecyStatus.textContent = 'Paused';
      }
    });

    prophecyAudio.addEventListener('ended', function () {
      prophecyBtn.textContent = 'Play';
      prophecyBtn.classList.remove('playing');
      if (prophecyStatus) prophecyStatus.textContent = '';
    });
  }
});
