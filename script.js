const CONFIG = {
  storageKey: "addition-clicker-save-v1",
  saveVersion: 1,
  ranges: [6, 10, 20, 30, 40, 50, 100, 200, 300, 400, 500, 1000],
  unlockScores: [0, 150, 450, 900, 1500, 2200, 3500, 5500, 8000, 11000, 15000, 22000],
  correctRevealMs: 300,
  wrongFlashMs: 220,
  tickMs: 100,
  autoSaveMs: 1000,
  timeBonus: {
    fastMs: 3000,
    middleMs: 5000,
    fastMultiplier: 3,
    middleMultiplier: 2,
    slowMultiplier: 1,
  },
  combo: {
    step: 0.1,
    maxStreakForGrowth: 40,
    maxMultiplier: 5.0,
    milestoneEvery: 5,
  },
  sound: {
    volume: 0.03,
  },
};

const ui = {};
let state = createDefaultState();
let audioContext = null;
let saveLoopElapsed = 0;
let tickHandle = null;
let feedbackTimer = null;
let wrongTimer = null;

function createDefaultState() {
  const firstRange = CONFIG.ranges[0];
  return {
    totalScore: 0,
    unlockedIndex: 0,
    selectedRanges: {
      left: firstRange,
      right: firstRange,
    },
    soundEnabled: false,
    comboStreak: 0,
    stats: {
      playTimeMs: 0,
      solvedCount: 0,
      maxCombo: 0,
      bestSingleScore: 0,
    },
    runtime: {
      isPaused: false,
      inputLocked: false,
      questionElapsedMs: 0,
      questionStartedAt: 0,
      playStartedAt: 0,
    },
    question: null,
    feedback: null,
  };
}

function getPersistentState() {
  return {
    version: CONFIG.saveVersion,
    totalScore: state.totalScore,
    unlockedIndex: state.unlockedIndex,
    selectedRanges: {
      left: state.selectedRanges.left,
      right: state.selectedRanges.right,
    },
    soundEnabled: state.soundEnabled,
    stats: {
      playTimeMs: getCurrentPlayTimeMs(),
      solvedCount: state.stats.solvedCount,
      maxCombo: state.stats.maxCombo,
      bestSingleScore: state.stats.bestSingleScore,
    },
  };
}

function normalizeLoadedState(raw) {
  const fallback = createDefaultState();
  const normalized = {
    totalScore: Number.isFinite(raw?.totalScore) ? Math.max(0, Math.floor(raw.totalScore)) : 0,
    unlockedIndex: Number.isFinite(raw?.unlockedIndex) ? Math.floor(raw.unlockedIndex) : 0,
    selectedRanges: {
      left: CONFIG.ranges[0],
      right: CONFIG.ranges[0],
    },
    soundEnabled: Boolean(raw?.soundEnabled),
    stats: {
      playTimeMs: Number.isFinite(raw?.stats?.playTimeMs) ? Math.max(0, Math.floor(raw.stats.playTimeMs)) : 0,
      solvedCount: Number.isFinite(raw?.stats?.solvedCount) ? Math.max(0, Math.floor(raw.stats.solvedCount)) : 0,
      maxCombo: Number.isFinite(raw?.stats?.maxCombo) ? Math.max(0, Math.floor(raw.stats.maxCombo)) : 0,
      bestSingleScore: Number.isFinite(raw?.stats?.bestSingleScore) ? Math.max(0, Math.floor(raw.stats.bestSingleScore)) : 0,
    },
  };

  normalized.unlockedIndex = clamp(normalized.unlockedIndex, 0, CONFIG.ranges.length - 1);

  if (CONFIG.unlockScores[normalized.unlockedIndex] > normalized.totalScore) {
    let recalculated = 0;
    for (let i = 0; i < CONFIG.unlockScores.length; i += 1) {
      if (normalized.totalScore >= CONFIG.unlockScores[i]) {
        recalculated = i;
      }
    }
    normalized.unlockedIndex = recalculated;
  }

  const maxUnlockedRange = CONFIG.ranges[normalized.unlockedIndex];
  const rawLeft = Number(raw?.selectedRanges?.left);
  const rawRight = Number(raw?.selectedRanges?.right);
  normalized.selectedRanges.left = sanitizeSelectedRange(rawLeft, maxUnlockedRange);
  normalized.selectedRanges.right = sanitizeSelectedRange(rawRight, maxUnlockedRange);

  return {
    ...fallback,
    totalScore: normalized.totalScore,
    unlockedIndex: normalized.unlockedIndex,
    selectedRanges: normalized.selectedRanges,
    soundEnabled: normalized.soundEnabled,
    stats: normalized.stats,
  };
}

function sanitizeSelectedRange(value, maxUnlockedRange) {
  if (!CONFIG.ranges.includes(value)) {
    return CONFIG.ranges[0];
  }
  return Math.min(value, maxUnlockedRange);
}

function loadState() {
  try {
    const raw = localStorage.getItem(CONFIG.storageKey);
    if (!raw) {
      return createDefaultState();
    }
    const parsed = JSON.parse(raw);
    return normalizeLoadedState(parsed);
  } catch (error) {
    return createDefaultState();
  }
}

function saveState() {
  try {
    localStorage.setItem(CONFIG.storageKey, JSON.stringify(getPersistentState()));
  } catch (error) {
    // 保存失敗時は無視
  }
}

function cacheDom() {
  ui.body = document.body;
  ui.soundToggle = document.getElementById("soundToggle");
  ui.pauseButton = document.getElementById("pauseButton");
  ui.scoreValue = document.getElementById("scoreValue");
  ui.comboValue = document.getElementById("comboValue");
  ui.timeValue = document.getElementById("timeValue");
  ui.unlockText = document.getElementById("unlockText");
  ui.unlockFill = document.getElementById("unlockFill");
  ui.unlockDetail = document.getElementById("unlockDetail");
  ui.leftRangeCurrent = document.getElementById("leftRangeCurrent");
  ui.leftRangeNext = document.getElementById("leftRangeNext");
  ui.rightRangeCurrent = document.getElementById("rightRangeCurrent");
  ui.rightRangeNext = document.getElementById("rightRangeNext");
  ui.modalLeftRangeCurrent = document.getElementById("modalLeftRangeCurrent");
  ui.modalLeftRangeNext = document.getElementById("modalLeftRangeNext");
  ui.modalRightRangeCurrent = document.getElementById("modalRightRangeCurrent");
  ui.modalRightRangeNext = document.getElementById("modalRightRangeNext");
  ui.questionText = document.getElementById("questionText");
  ui.answersGrid = document.getElementById("answersGrid");
  ui.feedbackLayer = document.getElementById("feedbackLayer");
  ui.pauseModal = document.getElementById("pauseModal");
  ui.modalBackdrop = document.getElementById("modalBackdrop");
  ui.resumeButton = document.getElementById("resumeButton");
  ui.resumeTopButton = document.getElementById("resumeTopButton");
  ui.modalSoundToggle = document.getElementById("modalSoundToggle");
  ui.exportCode = document.getElementById("exportCode");
  ui.importCode = document.getElementById("importCode");
  ui.generateCodeButton = document.getElementById("generateCodeButton");
  ui.copyCodeButton = document.getElementById("copyCodeButton");
  ui.importCodeButton = document.getElementById("importCodeButton");
  ui.transferMessage = document.getElementById("transferMessage");
  ui.statPlayTime = document.getElementById("statPlayTime");
  ui.statTotalScore = document.getElementById("statTotalScore");
  ui.statSolvedCount = document.getElementById("statSolvedCount");
  ui.statMaxCombo = document.getElementById("statMaxCombo");
  ui.statBestSingle = document.getElementById("statBestSingle");
  ui.rangeButtons = Array.from(document.querySelectorAll("[data-range-side][data-range-dir]"));
}

function bindEvents() {
  ui.soundToggle.addEventListener("click", () => {
    toggleSound();
  });

  ui.modalSoundToggle.addEventListener("click", () => {
    toggleSound();
  });

  ui.pauseButton.addEventListener("click", () => {
    if (state.runtime.inputLocked) {
      return;
    }
    pauseGame();
  });

  ui.resumeButton.addEventListener("click", resumeGame);
  ui.resumeTopButton.addEventListener("click", resumeGame);
  ui.modalBackdrop.addEventListener("click", resumeGame);

  ui.rangeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (state.runtime.inputLocked) {
        return;
      }
      const side = button.dataset.rangeSide;
      const dir = Number(button.dataset.rangeDir);
      cycleRange(side, dir);
    });
  });

  ui.generateCodeButton.addEventListener("click", () => {
    updateExportCode();
    setTransferMessage("引き継ぎコードを生成しました。", true);
  });

  ui.copyCodeButton.addEventListener("click", async () => {
    updateExportCode();
    try {
      await navigator.clipboard.writeText(ui.exportCode.value);
      setTransferMessage("引き継ぎコードをコピーしました。", true);
    } catch (error) {
      ui.exportCode.focus();
      ui.exportCode.select();
      setTransferMessage("コピーに失敗したため、手動でコピーしてください。", false);
    }
  });

  ui.importCodeButton.addEventListener("click", () => {
    importFromCode(ui.importCode.value.trim());
  });

  window.addEventListener("beforeunload", saveState);
}

function init() {
  cacheDom();
  bindEvents();
  state = loadState();
  state.runtime.playStartedAt = performance.now();
  createQuestion();
  renderAll();
  startTickLoop();
}

function startTickLoop() {
  if (tickHandle) {
    clearInterval(tickHandle);
  }
  tickHandle = setInterval(() => {
    renderLive();
    saveLoopElapsed += CONFIG.tickMs;
    if (saveLoopElapsed >= CONFIG.autoSaveMs) {
      saveLoopElapsed = 0;
      saveState();
    }
  }, CONFIG.tickMs);
}

function createQuestion() {
  const leftMax = state.selectedRanges.left;
  const rightMax = state.selectedRanges.right;
  const a = randomInt(1, leftMax);
  const b = randomInt(1, rightMax);
  const sum = a + b;

  state.question = {
    a,
    b,
    sum,
    leftMax,
    rightMax,
    timeLost: false,
    options: buildOptions(sum),
  };

  state.feedback = null;
  state.runtime.questionElapsedMs = 0;
  state.runtime.questionStartedAt = state.runtime.isPaused ? 0 : performance.now();
  updateAnswerButtons();
  renderAll();
}

function buildOptions(correctAnswer) {
  const pool = new Set();
  const nearDiffs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15];

  for (let i = 0; i < nearDiffs.length; i += 1) {
    const diff = nearDiffs[i];
    if (correctAnswer - diff >= 1) {
      pool.add(correctAnswer - diff);
    }
    pool.add(correctAnswer + diff);
    if (pool.size >= 10) {
      break;
    }
  }

  let expand = 1;
  while (pool.size < 10) {
    const min = Math.max(1, correctAnswer - 12 - expand);
    const max = correctAnswer + 12 + expand;
    pool.add(randomInt(min, max));
    expand += 2;
    if (expand > 50) {
      break;
    }
  }

  pool.delete(correctAnswer);
  const wrongChoices = shuffle(Array.from(pool)).slice(0, 3);
  const result = shuffle([correctAnswer, ...wrongChoices]);

  while (result.length < 4) {
    const extra = Math.max(1, correctAnswer + randomInt(-20, 20));
    if (!result.includes(extra) && extra !== correctAnswer) {
      result.push(extra);
    }
  }

  return shuffle(result);
}

function updateAnswerButtons() {
  ui.answersGrid.innerHTML = "";

  state.question.options.forEach((value) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "answer-button";
    button.textContent = formatNumber(value);
    button.dataset.value = String(value);
    button.disabled = state.runtime.isPaused || state.runtime.inputLocked;
    button.addEventListener("click", () => handleAnswer(value, button));
    ui.answersGrid.appendChild(button);
  });
}

function handleAnswer(value, button) {
  if (state.runtime.isPaused || state.runtime.inputLocked || !state.question) {
    return;
  }

  if (value === state.question.sum) {
    handleCorrectAnswer(button);
  } else {
    handleWrongAnswer(button);
  }
}

function handleWrongAnswer(button) {
  state.runtime.inputLocked = true;
  state.comboStreak = 0;
  state.question.timeLost = true;
  playWrongSound();

  button.classList.add("wrong-flash");
  renderAll();

  clearTimeout(wrongTimer);
  wrongTimer = setTimeout(() => {
    state.question.options = buildOptions(state.question.sum);
    state.runtime.inputLocked = false;
    updateAnswerButtons();
    renderAll();
  }, CONFIG.wrongFlashMs);
}

function handleCorrectAnswer(button) {
  state.runtime.inputLocked = true;

  const timeMultiplier = getTimeMultiplier();
  const comboMultiplier = getComboMultiplier(state.comboStreak);
  const gain = Math.ceil(state.question.sum * timeMultiplier * comboMultiplier);

  state.totalScore += gain;
  state.stats.solvedCount += 1;
  state.stats.bestSingleScore = Math.max(state.stats.bestSingleScore, gain);

  const newCombo = state.comboStreak + 1;
  state.comboStreak = newCombo;
  state.stats.maxCombo = Math.max(state.stats.maxCombo, newCombo);

  const unlockedRanges = unlockByScore();
  const comboMilestone = newCombo > 0 && newCombo % CONFIG.combo.milestoneEvery === 0;

  button.classList.add("correct");
  playCorrectSound();
  if (comboMilestone) {
    setTimeout(() => {
      playComboSound();
    }, 50);
  }

  state.feedback = {
    gain,
    sum: state.question.sum,
    timeMultiplier,
    comboMultiplier,
    comboMilestoneText: comboMilestone ? `${newCombo} COMBO!` : "",
    unlockText: unlockedRanges.length > 0 ? `${unlockedRanges.join(" / ")} 解放!` : "",
  };

  renderAll();
  saveState();

  clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => {
    state.runtime.inputLocked = false;
    createQuestion();
    saveState();
  }, CONFIG.correctRevealMs);
}

function unlockByScore() {
  const unlockedNames = [];
  while (
    state.unlockedIndex < CONFIG.ranges.length - 1 &&
    state.totalScore >= CONFIG.unlockScores[state.unlockedIndex + 1]
  ) {
    state.unlockedIndex += 1;
    unlockedNames.push(`1〜${CONFIG.ranges[state.unlockedIndex]}`);
  }

  const maxAllowed = CONFIG.ranges[state.unlockedIndex];
  state.selectedRanges.left = Math.min(state.selectedRanges.left, maxAllowed);
  state.selectedRanges.right = Math.min(state.selectedRanges.right, maxAllowed);

  return unlockedNames;
}

function cycleRange(side, dir) {
  const current = state.selectedRanges[side];
  const currentIndex = CONFIG.ranges.indexOf(current);
  const nextIndex = clamp(currentIndex + dir, 0, state.unlockedIndex);
  state.selectedRanges[side] = CONFIG.ranges[nextIndex];
  renderAll();
  saveState();
}

function pauseGame() {
  if (state.runtime.isPaused) {
    return;
  }

  const now = performance.now();
  if (state.runtime.playStartedAt) {
    state.stats.playTimeMs += now - state.runtime.playStartedAt;
  }
  if (state.runtime.questionStartedAt) {
    state.runtime.questionElapsedMs += now - state.runtime.questionStartedAt;
  }

  state.runtime.playStartedAt = 0;
  state.runtime.questionStartedAt = 0;
  state.runtime.isPaused = true;
  ui.body.classList.add("is-paused");
  ui.pauseModal.classList.remove("hidden");
  ui.pauseModal.setAttribute("aria-hidden", "false");
  updateExportCode();
  renderAll();
  saveState();
}

function resumeGame() {
  if (!state.runtime.isPaused) {
    return;
  }

  state.runtime.isPaused = false;
  state.runtime.playStartedAt = performance.now();
  state.runtime.questionStartedAt = performance.now();
  ui.body.classList.remove("is-paused");
  ui.pauseModal.classList.add("hidden");
  ui.pauseModal.setAttribute("aria-hidden", "true");
  renderAll();
  saveState();
}

function toggleSound() {
  state.soundEnabled = !state.soundEnabled;
  if (state.soundEnabled) {
    ensureAudioContext();
  }
  renderAll();
  saveState();
}

function ensureAudioContext() {
  if (!audioContext) {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) {
      return null;
    }
    audioContext = new AudioCtor();
  }
  if (audioContext.state === "suspended") {
    audioContext.resume().catch(() => {});
  }
  return audioContext;
}

function playToneSequence(notes) {
  if (!state.soundEnabled) {
    return;
  }
  const ctx = ensureAudioContext();
  if (!ctx) {
    return;
  }

  let cursor = ctx.currentTime;
  notes.forEach((note) => {
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.type = note.type || "sine";
    oscillator.frequency.setValueAtTime(note.freq, cursor);

    gainNode.gain.setValueAtTime(0.0001, cursor);
    gainNode.gain.exponentialRampToValueAtTime(CONFIG.sound.volume * (note.volume || 1), cursor + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, cursor + note.duration);

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.start(cursor);
    oscillator.stop(cursor + note.duration + 0.02);
    cursor += note.gap ?? note.duration;
  });
}

function playCorrectSound() {
  playToneSequence([
    { freq: 660, duration: 0.07, gap: 0.05, type: "triangle", volume: 0.8 },
    { freq: 880, duration: 0.1, gap: 0.09, type: "triangle", volume: 0.95 },
  ]);
}

function playWrongSound() {
  playToneSequence([
    { freq: 240, duration: 0.08, gap: 0.07, type: "sawtooth", volume: 0.7 },
    { freq: 180, duration: 0.11, gap: 0.11, type: "sawtooth", volume: 0.65 },
  ]);
}

function playComboSound() {
  playToneSequence([
    { freq: 784, duration: 0.06, gap: 0.045, type: "triangle", volume: 0.8 },
    { freq: 988, duration: 0.06, gap: 0.045, type: "triangle", volume: 0.85 },
    { freq: 1318, duration: 0.14, gap: 0.14, type: "triangle", volume: 1.0 },
  ]);
}

function renderAll() {
  renderScore();
  renderStatus();
  renderUnlockProgress();
  renderRanges();
  renderQuestion();
  renderFeedback();
  renderButtonsState();
  renderPauseModal();
}

function renderLive() {
  renderStatus();
  if (state.runtime.isPaused) {
    renderPauseModal();
  }
}

function renderScore() {
  ui.scoreValue.textContent = formatNumber(state.totalScore);
  ui.statTotalScore.textContent = formatNumber(state.totalScore);
}

function renderStatus() {
  ui.comboValue.textContent = `×${formatMultiplier(getComboMultiplier(state.comboStreak))}`;

  if (!state.question) {
    ui.timeValue.textContent = "×3";
  } else if (state.question.timeLost) {
    ui.timeValue.textContent = "LOST";
  } else {
    ui.timeValue.textContent = `×${formatMultiplier(getTimeMultiplier())}`;
  }
}

function renderUnlockProgress() {
  if (state.unlockedIndex >= CONFIG.ranges.length - 1) {
    ui.unlockText.textContent = "すべて解放済み";
    ui.unlockDetail.textContent = "MAX";
    ui.unlockFill.style.width = "100%";
    return;
  }

  const currentFloor = CONFIG.unlockScores[state.unlockedIndex];
  const nextTarget = CONFIG.unlockScores[state.unlockedIndex + 1];
  const progress = clamp((state.totalScore - currentFloor) / (nextTarget - currentFloor), 0, 1);

  ui.unlockText.textContent = `1〜${CONFIG.ranges[state.unlockedIndex + 1]}`;
  ui.unlockDetail.textContent = `${formatNumber(state.totalScore)} / ${formatNumber(nextTarget)}`;
  ui.unlockFill.style.width = `${progress * 100}%`;
}

function renderRanges() {
  renderRangeBlock("left", ui.leftRangeCurrent, ui.leftRangeNext, ui.modalLeftRangeCurrent, ui.modalLeftRangeNext);
  renderRangeBlock("right", ui.rightRangeCurrent, ui.rightRangeNext, ui.modalRightRangeCurrent, ui.modalRightRangeNext);

  ui.rangeButtons.forEach((button) => {
    const side = button.dataset.rangeSide;
    const dir = Number(button.dataset.rangeDir);
    const currentIndex = CONFIG.ranges.indexOf(state.selectedRanges[side]);
    const nextIndex = currentIndex + dir;
    button.disabled = nextIndex < 0 || nextIndex > state.unlockedIndex;
  });
}

function renderRangeBlock(side, currentEl, nextEl, modalCurrentEl, modalNextEl) {
  const activeRange = state.question ? state.question[side === "left" ? "leftMax" : "rightMax"] : state.selectedRanges[side];
  const selectedRange = state.selectedRanges[side];
  const nextText = activeRange === selectedRange ? "" : `次から 1〜${selectedRange}`;

  currentEl.textContent = `1〜${activeRange}`;
  nextEl.textContent = nextText;
  modalCurrentEl.textContent = `1〜${activeRange}`;
  modalNextEl.textContent = nextText;
}

function renderQuestion() {
  if (!state.question) {
    ui.questionText.textContent = "";
    return;
  }
  ui.questionText.textContent = `${state.question.a} + ${state.question.b} = ?`;
}

function renderFeedback() {
  if (!state.feedback) {
    ui.feedbackLayer.classList.remove("show");
    ui.feedbackLayer.innerHTML = "";
    return;
  }

  const parts = [];
  parts.push(`<div><span class="highlight">TIME BONUS!</span> ×${formatMultiplier(state.feedback.timeMultiplier)}</div>`);
  parts.push(`<div><span class="highlight-good">COMBO!</span> ×${formatMultiplier(state.feedback.comboMultiplier)}</div>`);
  if (state.feedback.comboMilestoneText) {
    parts.push(`<div class="highlight-good">${escapeHtml(state.feedback.comboMilestoneText)}</div>`);
  }
  if (state.feedback.unlockText) {
    parts.push(`<div class="highlight">${escapeHtml(state.feedback.unlockText)}</div>`);
  }

  ui.feedbackLayer.innerHTML = `
    <div class="feedback-box">
      <div class="feedback-main">+${formatNumber(state.feedback.gain)}!</div>
      <div class="feedback-sub">+${formatNumber(state.feedback.sum)}!</div>
      <div class="feedback-lines">${parts.join("")}</div>
    </div>
  `;
  ui.feedbackLayer.classList.add("show");
}

function renderButtonsState() {
  const disabled = state.runtime.isPaused || state.runtime.inputLocked;
  Array.from(ui.answersGrid.children).forEach((button) => {
    button.disabled = disabled;
  });
  ui.soundToggle.textContent = state.soundEnabled ? "🔊" : "🔇";
  ui.modalSoundToggle.textContent = state.soundEnabled ? "ON" : "OFF";
  ui.pauseButton.disabled = state.runtime.inputLocked;
}

function renderPauseModal() {
  ui.statPlayTime.textContent = formatPlayTime(getCurrentPlayTimeMs());
  ui.statSolvedCount.textContent = formatNumber(state.stats.solvedCount);
  ui.statMaxCombo.textContent = formatNumber(state.stats.maxCombo);
  ui.statBestSingle.textContent = formatNumber(state.stats.bestSingleScore);
}

function getCurrentQuestionElapsedMs() {
  return state.runtime.questionElapsedMs + (state.runtime.questionStartedAt ? performance.now() - state.runtime.questionStartedAt : 0);
}

function getCurrentPlayTimeMs() {
  return Math.floor(state.stats.playTimeMs + (state.runtime.playStartedAt ? performance.now() - state.runtime.playStartedAt : 0));
}

function getTimeMultiplier() {
  if (!state.question || state.question.timeLost) {
    return CONFIG.timeBonus.slowMultiplier;
  }
  const elapsed = getCurrentQuestionElapsedMs();
  if (elapsed <= CONFIG.timeBonus.fastMs) {
    return CONFIG.timeBonus.fastMultiplier;
  }
  if (elapsed <= CONFIG.timeBonus.middleMs) {
    return CONFIG.timeBonus.middleMultiplier;
  }
  return CONFIG.timeBonus.slowMultiplier;
}

function getComboMultiplier(streak) {
  if (streak >= CONFIG.combo.maxStreakForGrowth) {
    return CONFIG.combo.maxMultiplier;
  }
  return 1 + streak * CONFIG.combo.step;
}

function updateExportCode() {
  ui.exportCode.value = encodeSaveData(getPersistentState());
}

function importFromCode(code) {
  if (!code) {
    setTransferMessage("引き継ぎコードを入力してください。", false);
    return;
  }

  try {
    const decoded = decodeSaveData(code);
    const loaded = normalizeLoadedState(decoded);

    clearTimeout(feedbackTimer);
    clearTimeout(wrongTimer);

    const fresh = createDefaultState();
    state = {
      ...fresh,
      totalScore: loaded.totalScore,
      unlockedIndex: loaded.unlockedIndex,
      selectedRanges: loaded.selectedRanges,
      soundEnabled: loaded.soundEnabled,
      stats: loaded.stats,
      runtime: {
        isPaused: true,
        inputLocked: false,
        questionElapsedMs: 0,
        questionStartedAt: 0,
        playStartedAt: 0,
      },
      question: null,
      feedback: null,
    };

    ui.importCode.value = "";
    createQuestion();
    ui.body.classList.add("is-paused");
    ui.pauseModal.classList.remove("hidden");
    ui.pauseModal.setAttribute("aria-hidden", "false");
    updateExportCode();
    renderAll();
    saveState();
    setTransferMessage("復元しました。再開すると新しい問題から始まります。", true);
  } catch (error) {
    setTransferMessage("コードを読み取れませんでした。", false);
  }
}

function setTransferMessage(message, success) {
  ui.transferMessage.textContent = message;
  ui.transferMessage.className = `transfer-message ${success ? "success-text" : "error-text"}`;
}

function encodeSaveData(data) {
  const json = JSON.stringify(data);
  return btoa(encodeURIComponent(json).replace(/%([0-9A-F]{2})/g, (_, hex) => {
    return String.fromCharCode(Number.parseInt(hex, 16));
  }));
}

function decodeSaveData(code) {
  const binary = atob(code);
  const percentEncoded = Array.from(binary, (char) => {
    return `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`;
  }).join("");
  return JSON.parse(decodeURIComponent(percentEncoded));
}

function formatPlayTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) {
    return `${days}日 ${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
  }
  if (hours > 0) {
    return `${hours}:${pad2(minutes)}:${pad2(seconds)}`;
  }
  return `${minutes}:${pad2(seconds)}`;
}

function formatNumber(value) {
  return Number(value).toLocaleString("ja-JP");
}

function formatMultiplier(value) {
  return Number(value).toFixed(1).replace(/\.0$/, ".0");
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

document.addEventListener("DOMContentLoaded", init);