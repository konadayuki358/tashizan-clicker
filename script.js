const CONFIG = {
  storageKey: "addition-clicker-save-v1",
  saveVersion: 2,
  ranges: [6, 10, 20, 30, 40, 50, 100, 200, 300, 400, 500, 1000],
  unlockScores: [0, 150, 450, 900, 1500, 2200, 3500, 5500, 8000, 11000, 15000, 22000],
  correctRevealMs: 300,
  wrongFlashMs: 220,
  tickMs: 100,
  autoSaveMs: 1000,
  reverseMaxAnswer: 2000,
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

const MODES = {
  addition: {
    key: "addition",
    label: "足し算",
    fullLabel: "足し算モード",
    scoreLabel: "足し算スコア",
  },
  reverse: {
    key: "reverse",
    label: "逆算",
    fullLabel: "逆算モード",
    scoreLabel: "逆算スコア",
  },
  mixed: {
    key: "mixed",
    label: "混合",
    fullLabel: "混合モード",
    scoreLabel: "混合スコア",
  },
};

const MODE_ORDER = ["addition", "reverse", "mixed"];
const FINAL_RANGE_INDEX = CONFIG.ranges.length - 1;

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
    modeScores: {
      addition: 0,
      reverse: 0,
      mixed: 0,
    },
    currentMode: "addition",
    pendingMode: "addition",
    unlockedIndex: 0,
    reverseUnlockedIndex: 0,
    unlockedModes: {
      reverse: false,
      mixed: false,
    },
    selectedRangesByMode: {
      addition: { left: firstRange, right: firstRange },
      reverse: { left: firstRange, right: firstRange },
      mixed: { left: firstRange, right: firstRange },
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
    totalScore: getTotalScore(),
    modeScores: {
      addition: state.modeScores.addition,
      reverse: state.modeScores.reverse,
      mixed: state.modeScores.mixed,
    },
    currentMode: state.pendingMode || state.currentMode,
    unlockedIndex: state.unlockedIndex,
    reverseUnlockedIndex: state.reverseUnlockedIndex,
    unlockedModes: {
      reverse: state.unlockedModes.reverse,
      mixed: state.unlockedModes.mixed,
    },
    selectedRanges: getSelectedRanges(state.currentMode),
    selectedRangesByMode: {
      addition: { ...state.selectedRangesByMode.addition },
      reverse: { ...state.selectedRangesByMode.reverse },
      mixed: { ...state.selectedRangesByMode.mixed },
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
  const oldTotalScore = Number.isFinite(raw?.totalScore) ? Math.max(0, Math.floor(raw.totalScore)) : 0;

  const additionScore = Number.isFinite(raw?.modeScores?.addition)
    ? Math.max(0, Math.floor(raw.modeScores.addition))
    : oldTotalScore;
  const reverseScore = Number.isFinite(raw?.modeScores?.reverse) ? Math.max(0, Math.floor(raw.modeScores.reverse)) : 0;
  const mixedScore = Number.isFinite(raw?.modeScores?.mixed) ? Math.max(0, Math.floor(raw.modeScores.mixed)) : 0;

  const additionUnlockedByScore = calculateUnlockedIndex(additionScore);
  const rawAdditionUnlockedIndex = Number.isFinite(raw?.unlockedIndex) ? Math.floor(raw.unlockedIndex) : additionUnlockedByScore;
  const additionUnlockedIndex = clamp(Math.min(rawAdditionUnlockedIndex, additionUnlockedByScore), 0, FINAL_RANGE_INDEX);

  const reverseUnlockedByScore = calculateUnlockedIndex(reverseScore);
  const rawReverseUnlockedIndex = Number.isFinite(raw?.reverseUnlockedIndex) ? Math.floor(raw.reverseUnlockedIndex) : reverseUnlockedByScore;
  const reverseUnlockedIndex = clamp(Math.min(rawReverseUnlockedIndex, reverseUnlockedByScore), 0, FINAL_RANGE_INDEX);

  const reverseUnlocked = Boolean(raw?.unlockedModes?.reverse || raw?.reverseUnlocked || additionUnlockedIndex >= FINAL_RANGE_INDEX);
  const mixedUnlocked = Boolean(raw?.unlockedModes?.mixed || raw?.mixedUnlocked || reverseUnlockedIndex >= FINAL_RANGE_INDEX);

  const oldSelectedRanges = raw?.selectedRanges || fallback.selectedRangesByMode.addition;
  const rawSelectedRangesByMode = raw?.selectedRangesByMode || {};

  const selectedRangesByMode = {
    addition: normalizeSelectedRangesForMode(
      rawSelectedRangesByMode.addition || oldSelectedRanges,
      additionUnlockedIndex,
    ),
    reverse: normalizeSelectedRangesForMode(
      rawSelectedRangesByMode.reverse || oldSelectedRanges,
      reverseUnlocked ? reverseUnlockedIndex : 0,
    ),
    mixed: normalizeSelectedRangesForMode(
      rawSelectedRangesByMode.mixed || oldSelectedRanges,
      mixedUnlocked ? FINAL_RANGE_INDEX : 0,
    ),
  };

  let currentMode = typeof raw?.currentMode === "string" ? raw.currentMode : "addition";
  if (!isModeAvailable(currentMode, { reverse: reverseUnlocked, mixed: mixedUnlocked })) {
    currentMode = "addition";
  }

  return {
    ...fallback,
    modeScores: {
      addition: additionScore,
      reverse: reverseScore,
      mixed: mixedScore,
    },
    currentMode,
    pendingMode: currentMode,
    unlockedIndex: additionUnlockedIndex,
    reverseUnlockedIndex,
    unlockedModes: {
      reverse: reverseUnlocked,
      mixed: mixedUnlocked,
    },
    selectedRangesByMode,
    soundEnabled: Boolean(raw?.soundEnabled),
    stats: {
      playTimeMs: Number.isFinite(raw?.stats?.playTimeMs) ? Math.max(0, Math.floor(raw.stats.playTimeMs)) : 0,
      solvedCount: Number.isFinite(raw?.stats?.solvedCount) ? Math.max(0, Math.floor(raw.stats.solvedCount)) : 0,
      maxCombo: Number.isFinite(raw?.stats?.maxCombo) ? Math.max(0, Math.floor(raw.stats.maxCombo)) : 0,
      bestSingleScore: Number.isFinite(raw?.stats?.bestSingleScore) ? Math.max(0, Math.floor(raw.stats.bestSingleScore)) : 0,
    },
  };
}

function normalizeSelectedRangesForMode(rawRanges, unlockedIndex) {
  const maxUnlockedRange = CONFIG.ranges[clamp(unlockedIndex, 0, FINAL_RANGE_INDEX)];
  const rawLeft = Number(rawRanges?.left);
  const rawRight = Number(rawRanges?.right);
  return {
    left: sanitizeSelectedRange(rawLeft, maxUnlockedRange),
    right: sanitizeSelectedRange(rawRight, maxUnlockedRange),
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
  ui.scoreLabel = document.getElementById("scoreLabel");
  ui.scoreValue = document.getElementById("scoreValue");
  ui.currentModeName = document.getElementById("currentModeName");
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
  ui.statAdditionScore = document.getElementById("statAdditionScore");
  ui.statReverseScore = document.getElementById("statReverseScore");
  ui.statMixedScore = document.getElementById("statMixedScore");
  ui.statSolvedCount = document.getElementById("statSolvedCount");
  ui.statMaxCombo = document.getElementById("statMaxCombo");
  ui.statBestSingle = document.getElementById("statBestSingle");
  ui.rangeButtons = Array.from(document.querySelectorAll("[data-range-side][data-range-dir]"));
  ui.modeButtons = Array.from(document.querySelectorAll("[data-mode-select]"));
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
      const context = button.closest(".modal-panel") ? "modal" : "main";
      cycleRange(side, dir, context);
    });
  });

  ui.modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const mode = button.dataset.modeSelect;
      selectPendingMode(mode);
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
  state.currentMode = getAvailableMode(state.pendingMode);
  state.pendingMode = state.currentMode;
  clampSelectedRangesForMode(state.currentMode);

  const selectedRanges = getSelectedRanges(state.currentMode);
  const leftMax = selectedRanges.left;
  const rightMax = selectedRanges.right;
  const questionType = state.currentMode === "mixed" ? (Math.random() < 0.5 ? "addition" : "reverse") : state.currentMode;

  state.question = questionType === "reverse"
    ? createReverseQuestion(leftMax, rightMax, state.currentMode)
    : createAdditionQuestion(leftMax, rightMax, state.currentMode);

  state.feedback = null;
  state.runtime.questionElapsedMs = 0;
  state.runtime.questionStartedAt = state.runtime.isPaused ? 0 : performance.now();
  updateAnswerButtons();
  renderAll();
}

function createAdditionQuestion(leftMax, rightMax, scoreMode) {
  const a = randomInt(1, leftMax);
  const b = randomInt(1, rightMax);
  const sum = a + b;

  return {
    type: "addition",
    scoreMode,
    a,
    b,
    sum,
    baseScore: sum,
    leftMax,
    rightMax,
    timeLost: false,
    options: buildNumberOptions(sum),
  };
}

function createReverseQuestion(leftMax, rightMax, scoreMode) {
  const a = randomInt(1, leftMax);
  const b = randomInt(1, rightMax);
  const target = clamp(a + b, 2, CONFIG.reverseMaxAnswer);
  const correctOption = {
    label: `${formatNumber(a)} + ${formatNumber(b)}`,
    isCorrect: true,
    a,
    b,
    sum: target,
  };

  return {
    type: "reverse",
    scoreMode,
    a,
    b,
    sum: target,
    baseScore: target,
    leftMax,
    rightMax,
    timeLost: false,
    options: buildReverseOptions(target, leftMax, rightMax, correctOption),
  };
}

function buildNumberOptions(correctAnswer) {
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
  const wrongChoices = shuffle(Array.from(pool)).slice(0, 3).map((value) => ({
    label: formatNumber(value),
    value,
    isCorrect: false,
  }));

  const result = shuffle([
    { label: formatNumber(correctAnswer), value: correctAnswer, isCorrect: true },
    ...wrongChoices,
  ]);

  while (result.length < 4) {
    const extra = Math.max(1, correctAnswer + randomInt(-20, 20));
    if (!result.some((option) => option.value === extra) && extra !== correctAnswer) {
      result.push({ label: formatNumber(extra), value: extra, isCorrect: false });
    }
  }

  return shuffle(result);
}

function buildReverseOptions(target, leftMax, rightMax, correctOption) {
  const usedLabels = new Set([correctOption.label]);
  const wrongOptions = [];
  const nearbySums = shuffle([
    target - 10,
    target - 9,
    target - 8,
    target - 7,
    target - 6,
    target - 5,
    target - 4,
    target - 3,
    target - 2,
    target - 1,
    target + 1,
    target + 2,
    target + 3,
    target + 4,
    target + 5,
    target + 6,
    target + 7,
    target + 8,
    target + 9,
    target + 10,
  ]);

  nearbySums.forEach((sum) => {
    if (wrongOptions.length >= 3) {
      return;
    }
    const option = createExpressionOptionForSum(sum, leftMax, rightMax, target, usedLabels);
    if (option) {
      wrongOptions.push(option);
      usedLabels.add(option.label);
    }
  });

  let attempts = 0;
  while (wrongOptions.length < 3 && attempts < 500) {
    attempts += 1;
    const a = randomInt(1, leftMax);
    const b = randomInt(1, rightMax);
    const sum = a + b;
    const label = `${formatNumber(a)} + ${formatNumber(b)}`;

    if (sum !== target && sum <= CONFIG.reverseMaxAnswer && !usedLabels.has(label)) {
      const option = { label, isCorrect: false, a, b, sum };
      wrongOptions.push(option);
      usedLabels.add(label);
    }
  }

  return shuffle([correctOption, ...wrongOptions]).slice(0, 4);
}

function createExpressionOptionForSum(sum, leftMax, rightMax, correctTarget, usedLabels) {
  if (sum < 2 || sum > CONFIG.reverseMaxAnswer || sum === correctTarget) {
    return null;
  }

  const minA = Math.max(1, sum - rightMax);
  const maxA = Math.min(leftMax, sum - 1);
  if (minA > maxA) {
    return null;
  }

  const candidates = [];
  for (let a = minA; a <= maxA; a += 1) {
    const b = sum - a;
    if (b >= 1 && b <= rightMax) {
      const label = `${formatNumber(a)} + ${formatNumber(b)}`;
      if (!usedLabels.has(label)) {
        candidates.push({ label, isCorrect: false, a, b, sum });
      }
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  return candidates[randomInt(0, candidates.length - 1)];
}

function rebuildOptionsForQuestion(question) {
  if (question.type === "reverse") {
    const correctOption = {
      label: `${formatNumber(question.a)} + ${formatNumber(question.b)}`,
      isCorrect: true,
      a: question.a,
      b: question.b,
      sum: question.sum,
    };
    return buildReverseOptions(question.sum, question.leftMax, question.rightMax, correctOption);
  }

  return buildNumberOptions(question.sum);
}

function updateAnswerButtons() {
  ui.answersGrid.innerHTML = "";

  state.question.options.forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `answer-button${state.question.type === "reverse" ? " expression-answer" : ""}`;
    button.textContent = option.label;
    button.disabled = state.runtime.isPaused || state.runtime.inputLocked;
    button.addEventListener("click", () => handleAnswer(option, button));
    ui.answersGrid.appendChild(button);
  });
}

function handleAnswer(option, button) {
  if (state.runtime.isPaused || state.runtime.inputLocked || !state.question) {
    return;
  }

  if (option.isCorrect) {
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
    state.question.options = rebuildOptionsForQuestion(state.question);
    state.runtime.inputLocked = false;
    updateAnswerButtons();
    renderAll();
  }, CONFIG.wrongFlashMs);
}

function handleCorrectAnswer(button) {
  state.runtime.inputLocked = true;

  const timeMultiplier = getTimeMultiplier();
  const comboMultiplier = getComboMultiplier(state.comboStreak);
  const gain = Math.ceil(state.question.baseScore * timeMultiplier * comboMultiplier);
  const scoreMode = state.question.scoreMode;

  state.modeScores[scoreMode] += gain;
  state.stats.solvedCount += 1;
  state.stats.bestSingleScore = Math.max(state.stats.bestSingleScore, gain);

  const newCombo = state.comboStreak + 1;
  state.comboStreak = newCombo;
  state.stats.maxCombo = Math.max(state.stats.maxCombo, newCombo);

  const unlockedMessages = unlockByScore(scoreMode);
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
    baseScore: state.question.baseScore,
    timeMultiplier,
    comboMultiplier,
    comboMilestoneText: comboMilestone ? `${newCombo} COMBO!` : "",
    unlockText: unlockedMessages.length > 0 ? `${unlockedMessages.join(" / ")}` : "",
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

function unlockByScore(scoreMode) {
  const messages = [];

  if (scoreMode === "addition") {
    while (
      state.unlockedIndex < FINAL_RANGE_INDEX &&
      state.modeScores.addition >= CONFIG.unlockScores[state.unlockedIndex + 1]
    ) {
      state.unlockedIndex += 1;
      messages.push(`1〜${CONFIG.ranges[state.unlockedIndex]} 解放!`);
    }

    if (!state.unlockedModes.reverse && state.unlockedIndex >= FINAL_RANGE_INDEX) {
      state.unlockedModes.reverse = true;
      messages.push("逆算モード解放!");
    }
  }

  if (scoreMode === "reverse") {
    while (
      state.reverseUnlockedIndex < FINAL_RANGE_INDEX &&
      state.modeScores.reverse >= CONFIG.unlockScores[state.reverseUnlockedIndex + 1]
    ) {
      state.reverseUnlockedIndex += 1;
      messages.push(`逆算 1〜${CONFIG.ranges[state.reverseUnlockedIndex]} 解放!`);
    }

    if (!state.unlockedModes.mixed && state.reverseUnlockedIndex >= FINAL_RANGE_INDEX) {
      state.unlockedModes.mixed = true;
      messages.push("混合モード解放!");
    }
  }

  clampAllSelectedRanges();
  return messages;
}

function cycleRange(side, dir, context) {
  const mode = context === "modal" ? state.pendingMode : state.currentMode;
  const selectedRanges = getSelectedRanges(mode);
  const current = selectedRanges[side];
  const currentIndex = CONFIG.ranges.indexOf(current);
  const maxIndex = getUnlockedIndexForMode(mode);
  const nextIndex = clamp(currentIndex + dir, 0, maxIndex);
  selectedRanges[side] = CONFIG.ranges[nextIndex];
  renderAll();
  saveState();
}

function selectPendingMode(mode) {
  if (!MODE_ORDER.includes(mode) || !isModeAvailable(mode)) {
    return;
  }

  state.pendingMode = mode;
  clampSelectedRangesForMode(mode);
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
  state.pendingMode = getAvailableMode(state.pendingMode || state.currentMode);
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
  renderModeButtons();
  renderPauseModal();
}

function renderLive() {
  renderStatus();
  if (state.runtime.isPaused) {
    renderPauseModal();
  }
}

function renderScore() {
  const modeInfo = MODES[state.currentMode];
  ui.scoreLabel.textContent = modeInfo.scoreLabel;
  ui.currentModeName.textContent = modeInfo.label;
  ui.scoreValue.textContent = formatNumber(state.modeScores[state.currentMode]);
  ui.statTotalScore.textContent = formatNumber(getTotalScore());
  ui.statAdditionScore.textContent = formatNumber(state.modeScores.addition);
  ui.statReverseScore.textContent = formatNumber(state.modeScores.reverse);
  ui.statMixedScore.textContent = formatNumber(state.modeScores.mixed);
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
  const mode = state.currentMode;

  if (mode === "mixed") {
    ui.unlockText.textContent = "すべて解放済み";
    ui.unlockDetail.textContent = "MAX";
    ui.unlockFill.style.width = "100%";
    return;
  }

  const score = state.modeScores[mode];
  const unlockedIndex = getUnlockedIndexForMode(mode);

  if (unlockedIndex >= FINAL_RANGE_INDEX) {
    if (mode === "addition" && !state.unlockedModes.reverse) {
      state.unlockedModes.reverse = true;
    }
    if (mode === "reverse" && !state.unlockedModes.mixed) {
      state.unlockedModes.mixed = true;
    }
    ui.unlockText.textContent = mode === "addition" ? "逆算モード解放済み" : "混合モード解放済み";
    ui.unlockDetail.textContent = "MAX";
    ui.unlockFill.style.width = "100%";
    return;
  }

  const currentFloor = CONFIG.unlockScores[unlockedIndex];
  const nextTarget = CONFIG.unlockScores[unlockedIndex + 1];
  const progress = clamp((score - currentFloor) / (nextTarget - currentFloor), 0, 1);

  ui.unlockText.textContent = `1〜${CONFIG.ranges[unlockedIndex + 1]}`;
  ui.unlockDetail.textContent = `${formatNumber(score)} / ${formatNumber(nextTarget)}`;
  ui.unlockFill.style.width = `${progress * 100}%`;
}

function renderRanges() {
  renderRangeBlock("left", ui.leftRangeCurrent, ui.leftRangeNext, state.currentMode, true);
  renderRangeBlock("right", ui.rightRangeCurrent, ui.rightRangeNext, state.currentMode, true);
  renderRangeBlock("left", ui.modalLeftRangeCurrent, ui.modalLeftRangeNext, state.pendingMode, false);
  renderRangeBlock("right", ui.modalRightRangeCurrent, ui.modalRightRangeNext, state.pendingMode, false);
}

function renderRangeBlock(side, currentEl, nextEl, mode, useActiveQuestionRange) {
  const selectedRange = getSelectedRanges(mode)[side];
  const activeRange = useActiveQuestionRange && state.question
    ? state.question[side === "left" ? "leftMax" : "rightMax"]
    : selectedRange;
  const nextText = activeRange === selectedRange ? "" : `次から 1〜${selectedRange}`;

  currentEl.textContent = `1〜${activeRange}`;
  nextEl.textContent = nextText;
}

function renderQuestion() {
  if (!state.question) {
    ui.questionText.textContent = "";
    return;
  }

  if (state.question.type === "reverse") {
    ui.questionText.textContent = formatNumber(state.question.sum);
    return;
  }

  ui.questionText.textContent = `${formatNumber(state.question.a)} + ${formatNumber(state.question.b)} = ?`;
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
      <div class="feedback-sub">+${formatNumber(state.feedback.baseScore)}!</div>
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

  ui.rangeButtons.forEach((button) => {
    const side = button.dataset.rangeSide;
    const dir = Number(button.dataset.rangeDir);
    const context = button.closest(".modal-panel") ? "modal" : "main";
    const mode = context === "modal" ? state.pendingMode : state.currentMode;
    const currentIndex = CONFIG.ranges.indexOf(getSelectedRanges(mode)[side]);
    const nextIndex = currentIndex + dir;
    const maxIndex = getUnlockedIndexForMode(mode);
    button.disabled = nextIndex < 0 || nextIndex > maxIndex;
  });
}

function renderModeButtons() {
  ui.modeButtons.forEach((button) => {
    const mode = button.dataset.modeSelect;
    const available = isModeAvailable(mode);
    const isSelected = state.pendingMode === mode;
    const labelEl = button.querySelector(".mode-button-label");
    const stateEl = button.querySelector(".mode-button-state");

    button.disabled = !available;
    button.classList.toggle("selected", isSelected);

    if (labelEl) {
      labelEl.textContent = MODES[mode].fullLabel;
    }
    if (stateEl) {
      stateEl.textContent = available ? (isSelected ? "選択中" : "選択可") : "未解放";
    }
  });
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

    state = {
      ...loaded,
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

function getTotalScore() {
  return state.modeScores.addition + state.modeScores.reverse + state.modeScores.mixed;
}

function calculateUnlockedIndex(score) {
  let unlockedIndex = 0;
  for (let i = 0; i < CONFIG.unlockScores.length; i += 1) {
    if (score >= CONFIG.unlockScores[i]) {
      unlockedIndex = i;
    }
  }
  return clamp(unlockedIndex, 0, FINAL_RANGE_INDEX);
}

function getUnlockedIndexForMode(mode) {
  if (mode === "reverse") {
    return state.unlockedModes.reverse ? state.reverseUnlockedIndex : 0;
  }
  if (mode === "mixed") {
    return state.unlockedModes.mixed ? FINAL_RANGE_INDEX : 0;
  }
  return state.unlockedIndex;
}

function getSelectedRanges(mode) {
  if (!state.selectedRangesByMode[mode]) {
    state.selectedRangesByMode[mode] = { left: CONFIG.ranges[0], right: CONFIG.ranges[0] };
  }
  return state.selectedRangesByMode[mode];
}

function clampSelectedRangesForMode(mode) {
  const selectedRanges = getSelectedRanges(mode);
  const maxAllowed = CONFIG.ranges[getUnlockedIndexForMode(mode)];
  selectedRanges.left = sanitizeSelectedRange(selectedRanges.left, maxAllowed);
  selectedRanges.right = sanitizeSelectedRange(selectedRanges.right, maxAllowed);
}

function clampAllSelectedRanges() {
  MODE_ORDER.forEach((mode) => clampSelectedRangesForMode(mode));
}

function isModeAvailable(mode, unlockedModes = state.unlockedModes) {
  if (mode === "addition") {
    return true;
  }
  if (mode === "reverse") {
    return Boolean(unlockedModes.reverse);
  }
  if (mode === "mixed") {
    return Boolean(unlockedModes.mixed);
  }
  return false;
}

function getAvailableMode(mode) {
  return isModeAvailable(mode) ? mode : "addition";
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
