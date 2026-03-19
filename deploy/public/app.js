const state = {
  projects: [],
  projectQuery: "",
  currentProject: null,
  historyEntries: [],
  selectedChapterNumber: null,
  composerOpen: false,
  activeTab: "manuscript",
  chapterEditMode: false,
  bibleEditMode: false,
  busy: false
};

const elements = {
  apiKeyInput: document.querySelector("#apiKeyInput"),
  biblePane: document.querySelector("#biblePane"),
  bibleTabButton: document.querySelector("#bibleTabButton"),
  chapterContent: document.querySelector("#chapterContent"),
  chapterStrip: document.querySelector("#chapterStrip"),
  composerPanel: document.querySelector("#composerPanel"),
  continueButton: document.querySelector("#continueButton"),
  continueForm: document.querySelector("#continueForm"),
  createProjectButton: document.querySelector("#createProjectButton"),
  createProjectForm: document.querySelector("#createProjectForm"),
  currentProjectMeta: document.querySelector("#currentProjectMeta"),
  currentProjectTitle: document.querySelector("#currentProjectTitle"),
  deleteProjectButton: document.querySelector("#deleteProjectButton"),
  exportProjectButton: document.querySelector("#exportProjectButton"),
  guidanceInput: document.querySelector("#guidanceInput"),
  hamburgerBtn: document.querySelector("#hamburgerBtn"),
  importProjectButton: document.querySelector("#importProjectButton"),
  importFileInput: document.querySelector("#importFileInput"),
  loadingMessage: document.querySelector("#loadingMessage"),
  loadingOverlay: document.querySelector("#loadingOverlay"),
  manuscriptPane: document.querySelector("#manuscriptPane"),
  manuscriptTabButton: document.querySelector("#manuscriptTabButton"),
  modelInput: document.querySelector("#modelInput"),
  projectActionBar: document.querySelector("#projectActionBar"),
  projectList: document.querySelector("#projectList"),
  projectSearchInput: document.querySelector("#projectSearchInput"),
  refreshProjectsButton: document.querySelector("#refreshProjectsButton"),
  renameProjectButton: document.querySelector("#renameProjectButton"),
  sidebar: document.querySelector("#sidebar"),
  sidebarOverlay: document.querySelector("#sidebarOverlay"),
  statusBox: document.querySelector("#statusBox"),
  storyBibleView: document.querySelector("#storyBibleView"),
  toggleCreatePanelButton: document.querySelector("#toggleCreatePanelButton")
};

bootstrap();

async function bootstrap() {
  restoreLocalSettings();
  bindEvents();
  await refreshProjects();
}

function bindEvents() {
  elements.createProjectForm.addEventListener("submit", handleCreateProject);
  elements.continueForm.addEventListener("submit", handleContinueProject);
  elements.refreshProjectsButton.addEventListener("click", refreshProjects);
  elements.toggleCreatePanelButton.addEventListener("click", toggleComposerPanel);
  elements.manuscriptTabButton.addEventListener("click", () => switchTab("manuscript"));
  elements.bibleTabButton.addEventListener("click", () => switchTab("bible"));
  elements.renameProjectButton.addEventListener("click", handleRenameProject);
  elements.exportProjectButton.addEventListener("click", handleExportProject);
  elements.deleteProjectButton.addEventListener("click", handleDeleteProject);
  elements.importProjectButton.addEventListener("click", () => elements.importFileInput.click());
  elements.importFileInput.addEventListener("change", handleImportProject);

  elements.projectSearchInput.addEventListener("input", (event) => {
    state.projectQuery = event.target.value.trim().toLowerCase();
    renderProjectList();
  });

  elements.apiKeyInput.addEventListener("input", () => {
    localStorage.setItem("novel-maker.apiKey", elements.apiKeyInput.value.trim());
  });

  elements.modelInput.addEventListener("input", () => {
    localStorage.setItem("novel-maker.model", elements.modelInput.value.trim());
  });

  elements.chapterContent.addEventListener("click", handleChapterContentClick);
  elements.storyBibleView.addEventListener("click", handleStoryBibleClick);
  window.addEventListener("beforeunload", handleBeforeUnload);
  window.addEventListener("keydown", handleGlobalKeydown);

  // Mobile sidebar
  elements.hamburgerBtn.addEventListener("click", toggleMobileSidebar);
  elements.sidebarOverlay.addEventListener("click", closeMobileSidebar);
}

function restoreLocalSettings() {
  elements.apiKeyInput.value = localStorage.getItem("novel-maker.apiKey") || "";
  elements.modelInput.value = localStorage.getItem("novel-maker.model") || "gemini-3.1-pro-preview";
  renderComposerState();
  renderTabState();
}

async function refreshProjects() {
  setStatus("프로젝트 목록을 불러오는 중입니다.", "info");

  try {
    const data = await api("/api/projects");
    state.projects = data.projects || [];
    renderProjectList();

    if (state.currentProject) {
      const existing = state.projects.find((project) => project.id === state.currentProject.id);
      if (existing) {
        await loadProject(existing.id, true);
        setStatus(`"${state.currentProject.title}" 프로젝트를 불러왔습니다.`, "success");
        return;
      }
    }

    if (state.projects.length > 0) {
      await loadProject(state.projects[0].id, true);
      setStatus(`"${state.currentProject.title}" 프로젝트를 불러왔습니다.`, "success");
      return;
    }

    state.currentProject = null;
    state.historyEntries = [];
    state.selectedChapterNumber = null;
    state.chapterEditMode = false;
    state.bibleEditMode = false;
    renderCurrentProject();
    setStatus("새 프로젝트를 만들 준비가 되었습니다.", "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function loadProject(projectId, silent = false) {
  const [projectData, historyData] = await Promise.all([
    api(`/api/projects/${projectId}`),
    api(`/api/projects/${projectId}/history`).catch(() => ({ entries: [] }))
  ]);

  state.currentProject = projectData.project;
  state.historyEntries = historyData.entries || [];
  state.selectedChapterNumber = getLatestChapterNumber(projectData.project);
  state.chapterEditMode = false;
  state.bibleEditMode = false;
  state.activeTab = "manuscript";
  state.composerOpen = false;
  renderComposerState();
  renderTabState();
  renderProjectList();
  renderCurrentProject();

  if (!silent) {
    setStatus(`"${state.currentProject.title}" 프로젝트를 불러왔습니다.`, "success");
  }
}

async function handleCreateProject(event) {
  event.preventDefault();
  if (state.busy) {
    return;
  }

  const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
  payload.apiKey = elements.apiKeyInput.value.trim();
  payload.model = elements.modelInput.value.trim() || "gemini-3.1-pro-preview";

  await withBusy("1화를 생성하고 있습니다.", async () => {
    const data = await api("/api/projects", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    const historyData = await api(`/api/projects/${data.project.id}/history`).catch(() => ({ entries: [] }));

    state.currentProject = data.project;
    state.historyEntries = historyData.entries || [];
    state.selectedChapterNumber = getLatestChapterNumber(data.project);
    state.chapterEditMode = false;
    state.bibleEditMode = false;
    state.activeTab = "manuscript";
    state.composerOpen = false;
    elements.guidanceInput.value = "";

    const projects = await api("/api/projects");
    state.projects = projects.projects || [];
    renderComposerState();
    renderTabState();
    renderProjectList();
    renderCurrentProject();
    setStatus(`"${data.project.title}"의 1화를 생성했습니다.`, "success");
  });
}

async function handleContinueProject(event) {
  event.preventDefault();
  if (!state.currentProject || state.busy) {
    return;
  }

  const nextNumber = state.currentProject.chapters.length + 1;

  await withBusy(`${nextNumber}화를 생성하고 있습니다.`, async () => {
    const data = await api(`/api/projects/${state.currentProject.id}/continue`, {
      method: "POST",
      body: JSON.stringify({
        apiKey: elements.apiKeyInput.value.trim(),
        guidance: elements.guidanceInput.value.trim()
      })
    });
    const historyData = await api(`/api/projects/${state.currentProject.id}/history`).catch(() => ({ entries: [] }));

    state.currentProject = data.project;
    state.historyEntries = historyData.entries || [];
    state.selectedChapterNumber = getLatestChapterNumber(data.project);
    state.chapterEditMode = false;
    state.activeTab = "manuscript";
    elements.guidanceInput.value = "";

    const projects = await api("/api/projects");
    state.projects = projects.projects || [];
    renderTabState();
    renderProjectList();
    renderCurrentProject();
    setStatus(`${state.currentProject.chapters.length}화를 생성했습니다.`, "success");
  });
}

async function handleRenameProject() {
  if (!state.currentProject || state.busy) {
    return;
  }

  const nextTitle = window.prompt("새 프로젝트 이름", state.currentProject.title);
  if (nextTitle === null) {
    return;
  }

  const title = nextTitle.trim();
  if (!title) {
    setStatus("프로젝트 이름은 비워둘 수 없습니다.", "error");
    return;
  }

  await withBusy("프로젝트 이름을 바꾸고 있습니다.", async () => {
    const data = await api(`/api/projects/${state.currentProject.id}`, {
      method: "PATCH",
      body: JSON.stringify({ title })
    });
    const historyData = await api(`/api/projects/${state.currentProject.id}/history`).catch(() => ({ entries: [] }));
    state.currentProject = data.project;
    state.historyEntries = historyData.entries || [];
    const projects = await api("/api/projects");
    state.projects = projects.projects || [];
    renderProjectList();
    renderCurrentProject();
    setStatus("프로젝트 이름을 변경했습니다.", "success");
  });
}

function handleExportProject() {
  if (!state.currentProject) {
    return;
  }

  const blob = new Blob([JSON.stringify(state.currentProject, null, 2)], { type: "application/json" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = `${slugify(state.currentProject.title || "project")}.json`;
  link.click();
  URL.revokeObjectURL(href);
  setStatus("프로젝트 JSON을 내보냈습니다.", "success");
}

async function handleImportProject(event) {
  const file = event.target.files[0];
  if (!file) return;

  event.target.value = ""; // reset

  await withBusy("프로젝트를 가져오고 있습니다.", async () => {
    try {
      const text = await file.text();
      const payload = JSON.parse(text);

      const data = await api("/api/projects/import", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      
      const historyData = await api(`/api/projects/${data.project.id}/history`).catch(() => ({ entries: [] }));

      state.currentProject = data.project;
      state.historyEntries = historyData.entries || [];
      state.selectedChapterNumber = getLatestChapterNumber(data.project);
      state.chapterEditMode = false;
      state.bibleEditMode = false;
      state.activeTab = "manuscript";
      
      const projects = await api("/api/projects");
      state.projects = projects.projects || [];
      renderTabState();
      renderProjectList();
      renderCurrentProject();
      setStatus(`"${data.project.title}" 프로젝트를 가져왔습니다.`, "success");
    } catch (err) {
      throw new Error("가져오기 실패: 올바른 프로젝트 JSON 파일이 아닙니다. " + err.message);
    }
  });
}

async function handleDeleteProject() {
  if (!state.currentProject || state.busy) {
    return;
  }

  const ok = window.confirm(`"${state.currentProject.title}" 프로젝트를 삭제할까요?`);
  if (!ok) {
    return;
  }

  await withBusy("프로젝트를 삭제하고 있습니다.", async () => {
    await api(`/api/projects/${state.currentProject.id}`, { method: "DELETE" });
    state.currentProject = null;
    state.historyEntries = [];
    state.selectedChapterNumber = null;
    state.chapterEditMode = false;
    state.bibleEditMode = false;
    await refreshProjects();
    setStatus("프로젝트를 삭제했습니다.", "success");
  });
}

async function handleChapterContentClick(event) {
  const action = event.target.closest("[data-action]");
  if (!action || !state.currentProject) {
    return;
  }

  const currentChapter = getSelectedChapter();
  if (!currentChapter) {
    return;
  }

  const type = action.dataset.action;

  if (type === "edit-chapter") {
    state.chapterEditMode = true;
    renderChapterContent();
    return;
  }

  if (type === "cancel-chapter-edit") {
    state.chapterEditMode = false;
    renderChapterContent();
    return;
  }

  if (type === "save-chapter") {
    await saveCurrentChapter(currentChapter);
    return;
  }

  if (type === "regenerate-chapter") {
    if (currentChapter.chapterNumber !== state.currentProject.chapters.length) {
      setStatus("현재는 마지막 화만 재생성할 수 있습니다.", "error");
      return;
    }

    const guidance = window.prompt("재생성 가이드", "");
    if (guidance === null) {
      return;
    }

    await withBusy(`${currentChapter.chapterNumber}화를 다시 쓰고 있습니다.`, async () => {
      const data = await api(`/api/projects/${state.currentProject.id}/chapters/${currentChapter.chapterNumber}/regenerate`, {
        method: "POST",
        body: JSON.stringify({
          apiKey: elements.apiKeyInput.value.trim(),
          guidance
        })
      });
      const historyData = await api(`/api/projects/${state.currentProject.id}/history`).catch(() => ({ entries: [] }));

      state.currentProject = data.project;
      state.historyEntries = historyData.entries || [];
      state.chapterEditMode = false;
      renderCurrentProject();
      setStatus(`${currentChapter.chapterNumber}화를 다시 생성했습니다.`, "success");
    });
  }
}

async function handleStoryBibleClick(event) {
  const action = event.target.closest("[data-action]");
  if (!action || !state.currentProject) {
    return;
  }

  const type = action.dataset.action;

  if (type === "edit-bible") {
    state.bibleEditMode = true;
    renderStoryBible();
    return;
  }

  if (type === "cancel-bible-edit") {
    state.bibleEditMode = false;
    renderStoryBible();
    return;
  }

  if (type === "save-bible") {
    await saveCurrentStoryBible();
    return;
  }

  if (type === "refresh-bible") {
    await withBusy("스토리 바이블을 다시 정리하고 있습니다.", async () => {
      const data = await api(`/api/projects/${state.currentProject.id}/story-bible`, {
        method: "POST",
        body: JSON.stringify({
          apiKey: elements.apiKeyInput.value.trim()
        })
      });
      const historyData = await api(`/api/projects/${state.currentProject.id}/history`).catch(() => ({ entries: [] }));

      state.currentProject = data.project;
      state.historyEntries = historyData.entries || [];
      state.bibleEditMode = false;
      renderCurrentProject();
      setStatus("스토리 바이블을 갱신했습니다.", "success");
    });
    return;
  }

  if (type === "restore-history") {
    const historyId = action.dataset.historyId;
    if (!historyId) {
      return;
    }

    const ok = window.confirm("이 저장본으로 되돌릴까요? 현재 상태는 새 저장본으로 남습니다.");
    if (!ok) {
      return;
    }

    await withBusy("저장본으로 복원하고 있습니다.", async () => {
      const data = await api(`/api/projects/${state.currentProject.id}/history/${historyId}/restore`, {
        method: "POST",
        body: JSON.stringify({})
      });
      const historyData = await api(`/api/projects/${state.currentProject.id}/history`).catch(() => ({ entries: [] }));

      state.currentProject = data.project;
      state.historyEntries = historyData.entries || [];
      state.bibleEditMode = false;
      state.chapterEditMode = false;
      state.selectedChapterNumber = getLatestChapterNumber(data.project);
      renderProjectList();
      renderCurrentProject();
      setStatus("저장본으로 복원했습니다.", "success");
    });
  }
}

async function saveCurrentChapter(chapter = getSelectedChapter()) {
  if (!state.currentProject || !chapter) {
    return;
  }

  const payload = readChapterEditorPayload(chapter);
  await withBusy(`${chapter.chapterNumber}화를 저장하고 있습니다.`, async () => {
    const data = await api(`/api/projects/${state.currentProject.id}/chapters/${chapter.chapterNumber}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
    const historyData = await api(`/api/projects/${state.currentProject.id}/history`).catch(() => ({ entries: [] }));

    state.currentProject = data.project;
    state.historyEntries = historyData.entries || [];
    state.chapterEditMode = false;
    renderProjectList();
    renderCurrentProject();
    setStatus("챕터를 저장했습니다. 필요하면 스토리 바이블도 갱신하세요.", "success");
  });
}

async function saveCurrentStoryBible() {
  if (!state.currentProject) {
    return;
  }

  const textarea = document.querySelector("#storyBibleEditor");
  if (!textarea) {
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(textarea.value);
  } catch {
    setStatus("스토리 바이블 JSON 형식이 올바르지 않습니다.", "error");
    return;
  }

  await withBusy("스토리 바이블을 저장하고 있습니다.", async () => {
    const data = await api(`/api/projects/${state.currentProject.id}/story-bible`, {
      method: "PATCH",
      body: JSON.stringify({ storyBible: parsed })
    });
    const historyData = await api(`/api/projects/${state.currentProject.id}/history`).catch(() => ({ entries: [] }));

    state.currentProject = data.project;
    state.historyEntries = historyData.entries || [];
    state.bibleEditMode = false;
    renderCurrentProject();
    setStatus("스토리 바이블을 저장했습니다.", "success");
  });
}

function handleBeforeUnload(event) {
  if (!state.chapterEditMode && !state.bibleEditMode) {
    return;
  }

  event.preventDefault();
  event.returnValue = "";
}

function handleGlobalKeydown(event) {
  const saveShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s";
  if (!saveShortcut || state.busy) {
    return;
  }

  if (state.chapterEditMode) {
    event.preventDefault();
    saveCurrentChapter();
    return;
  }

  if (state.bibleEditMode) {
    event.preventDefault();
    saveCurrentStoryBible();
  }
}

async function withBusy(message, task) {
  state.busy = true;
  syncButtons();
  showLoading(message);

  try {
    await task();
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    state.busy = false;
    syncButtons();
    hideLoading();
  }
}

function toggleComposerPanel() {
  state.composerOpen = !state.composerOpen;
  renderComposerState();
}

function renderComposerState() {
  elements.composerPanel.classList.toggle("is-open", state.composerOpen);
  elements.composerPanel.classList.toggle("is-collapsed", !state.composerOpen);
  elements.toggleCreatePanelButton.textContent = state.composerOpen ? "생성 닫기" : "새 프로젝트";
}

function toggleMobileSidebar() {
  const isOpen = elements.sidebar.classList.toggle("is-open");
  elements.sidebarOverlay.classList.toggle("visible", isOpen);
  elements.hamburgerBtn.textContent = isOpen ? "✕" : "☰";
  elements.hamburgerBtn.setAttribute("aria-label", isOpen ? "메뉴 닫기" : "메뉴 열기");
  document.body.style.overflow = isOpen ? "hidden" : "";
}

function closeMobileSidebar() {
  elements.sidebar.classList.remove("is-open");
  elements.sidebarOverlay.classList.remove("visible");
  elements.hamburgerBtn.textContent = "☰";
  elements.hamburgerBtn.setAttribute("aria-label", "메뉴 열기");
  document.body.style.overflow = "";
}

function switchTab(tab) {
  state.activeTab = tab;
  renderTabState();
}

function renderTabState() {
  const manuscriptActive = state.activeTab === "manuscript";
  elements.manuscriptTabButton.classList.toggle("active", manuscriptActive);
  elements.bibleTabButton.classList.toggle("active", !manuscriptActive);
  elements.manuscriptPane.classList.toggle("is-active", manuscriptActive);
  elements.biblePane.classList.toggle("is-active", !manuscriptActive);
}

function syncButtons() {
  const projectSelected = Boolean(state.currentProject);
  const nextNumber = projectSelected ? state.currentProject.chapters.length + 1 : 0;

  elements.createProjectButton.disabled = state.busy;
  elements.continueButton.disabled = state.busy || !projectSelected;
  elements.continueButton.textContent = projectSelected ? `${nextNumber}화 생성` : "다음 화 생성";
}

function renderProjectList() {
  const filteredProjects = state.projects.filter((project) => {
    if (!state.projectQuery) {
      return true;
    }

    const haystack = [
      project.title,
      project.lastChapterTitle,
      project.currentPlotState,
      Array.isArray(project.tags) ? project.tags.join(" ") : ""
    ].join(" ").toLowerCase();

    return haystack.includes(state.projectQuery);
  });

  if (!filteredProjects.length) {
    elements.projectList.innerHTML = `<div class="empty-state compact">표시할 프로젝트가 없습니다.</div>`;
    return;
  }

  elements.projectList.innerHTML = filteredProjects
    .map((project) => {
      const active = state.currentProject && state.currentProject.id === project.id ? "active" : "";
      return `
        <button class="project-card ${active}" type="button" data-project-id="${escapeHtml(project.id)}">
          <span class="project-card-title">${escapeHtml(project.title)}</span>
          <span class="project-card-meta">${project.chapterCount}화 · ${escapeHtml(project.lastChapterTitle || "챕터 없음")}</span>
        </button>
      `;
    })
    .join("");

  elements.projectList.querySelectorAll("[data-project-id]").forEach((button) => {
    button.addEventListener("click", () => {
      loadProject(button.dataset.projectId);
      closeMobileSidebar();
    });
  });
}

function renderCurrentProject() {
  renderProjectHeader();
  renderChapterStrip();
  renderChapterContent();
  renderStoryBible();
  syncButtons();
}

function renderProjectHeader() {
  if (!state.currentProject) {
    elements.currentProjectTitle.textContent = "프로젝트를 선택하거나 새로 만드세요";
    elements.currentProjectMeta.textContent = "왼쪽 목록에서 작품을 고르면 바로 읽고 수정할 수 있습니다.";
    elements.projectActionBar.classList.add("hidden");
    return;
  }

  const tags = Array.isArray(state.currentProject.config.tags) ? state.currentProject.config.tags.filter(Boolean) : [];
  elements.currentProjectTitle.textContent = state.currentProject.title;
  elements.currentProjectMeta.textContent = [
    `${state.currentProject.chapters.length}화 진행`,
    state.currentProject.config.pov,
    tags.length ? tags.join(", ") : "태그 없음",
    `마지막 저장 ${formatDateTime(state.currentProject.updatedAt)}`
  ].join(" · ");
  elements.projectActionBar.classList.remove("hidden");
}

function renderChapterStrip() {
  if (!state.currentProject || !state.currentProject.chapters.length) {
    elements.chapterStrip.innerHTML = `<div class="empty-state compact">챕터가 없습니다.</div>`;
    return;
  }

  const selectedNumber = ensureSelectedChapter();
  elements.chapterStrip.innerHTML = state.currentProject.chapters
    .map((chapter) => {
      const active = chapter.chapterNumber === selectedNumber ? "active" : "";
      return `
        <button class="chapter-chip ${active}" type="button" data-chapter-number="${chapter.chapterNumber}">
          <span class="chapter-chip-number">${chapter.chapterNumber}화</span>
          <span class="chapter-chip-title">${escapeHtml(chapter.chapterTitle)}</span>
        </button>
      `;
    })
    .join("");

  elements.chapterStrip.querySelectorAll("[data-chapter-number]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedChapterNumber = Number(button.dataset.chapterNumber);
      state.chapterEditMode = false;
      renderChapterStrip();
      renderChapterContent();
    });
  });
}

function renderChapterContent() {
  const chapter = getSelectedChapter();

  if (!state.currentProject || !chapter) {
    elements.chapterContent.className = "chapter-content empty-state";
    elements.chapterContent.textContent = "챕터를 선택하면 여기에 표시됩니다.";
    return;
  }

  const isLatest = chapter.chapterNumber === state.currentProject.chapters.length;
  elements.chapterContent.className = "chapter-content";

  if (state.chapterEditMode) {
    elements.chapterContent.innerHTML = `
      <div class="chapter-actions">
        <span class="helper-text">현재 화 수정</span>
        <div class="button-row">
          <button class="primary-button" type="button" data-action="save-chapter">저장</button>
          <button class="ghost-button" type="button" data-action="cancel-chapter-edit">취소</button>
          ${isLatest ? `<button class="ghost-button" type="button" data-action="regenerate-chapter">마지막 화 다시 쓰기</button>` : ""}
        </div>
      </div>

      <div class="grid two">
        <label class="field">
          <span>제목</span>
          <input id="chapterTitleEdit" type="text" value="${escapeAttribute(chapter.chapterTitle)}" />
        </label>
        <label class="field">
          <span>시간대</span>
          <input id="chapterTimeEdit" type="text" value="${escapeAttribute(chapter.metadata.timeOfDay)}" />
        </label>
      </div>

      <label class="field">
        <span>장소</span>
        <input id="chapterLocationEdit" type="text" value="${escapeAttribute(chapter.metadata.location)}" />
      </label>

      <label class="field">
        <span>요약</span>
        <textarea id="chapterSummaryEdit" rows="3">${escapeHtml(chapter.chapterSummary)}</textarea>
      </label>

      <label class="field">
        <span>다음 갈고리</span>
        <textarea id="chapterHookEdit" rows="3">${escapeHtml(chapter.nextHook)}</textarea>
      </label>

      <label class="field">
        <span>본문</span>
        <textarea id="chapterTextEdit" rows="18">${escapeHtml(chapter.chapterText)}</textarea>
      </label>
    `;
    return;
  }

  elements.chapterContent.innerHTML = `
    <div class="chapter-actions">
      <div class="meta-chips">
        <span class="chip">${escapeHtml(chapter.metadata.timeOfDay)}</span>
        <span class="chip">${escapeHtml(chapter.metadata.location)}</span>
        <span class="chip">${escapeHtml(chapter.metadata.pov)}</span>
        <span class="chip">${chapter.chapterText.length.toLocaleString("ko-KR")}자</span>
      </div>
      <div class="button-row">
        <button class="ghost-button" type="button" data-action="edit-chapter">현재 화 수정</button>
        ${isLatest ? `<button class="ghost-button" type="button" data-action="regenerate-chapter">마지막 화 다시 쓰기</button>` : ""}
      </div>
    </div>

    <div class="chapter-head">
      <p class="eyebrow">Chapter ${chapter.chapterNumber}</p>
      <h3>${escapeHtml(chapter.chapterTitle)}</h3>
    </div>

    <div class="grid two">
      <section class="info-card">
        <span class="label">요약</span>
        <p>${escapeHtml(chapter.chapterSummary)}</p>
      </section>
      <section class="info-card">
        <span class="label">다음 갈고리</span>
        <p>${escapeHtml(chapter.nextHook)}</p>
      </section>
    </div>

    <pre class="chapter-prose">${escapeHtml(chapter.chapterText)}</pre>
  `;
}

function renderStoryBible() {
  if (!state.currentProject) {
    elements.storyBibleView.className = "story-bible empty-state";
    elements.storyBibleView.textContent = "스토리 바이블이 여기에 표시됩니다.";
    return;
  }

  const bible = state.currentProject.storyBible || {};
  elements.storyBibleView.className = "story-bible";

  if (state.bibleEditMode) {
    elements.storyBibleView.innerHTML = `
      <div class="chapter-actions">
        <span class="helper-text">스토리 바이블 JSON 편집</span>
        <div class="button-row">
          <button class="primary-button" type="button" data-action="save-bible">저장</button>
          <button class="ghost-button" type="button" data-action="cancel-bible-edit">취소</button>
          <button class="ghost-button" type="button" data-action="refresh-bible">AI로 다시 정리</button>
        </div>
      </div>
      <label class="field">
        <span>스토리 바이블 JSON</span>
        <textarea id="storyBibleEditor" rows="22">${escapeHtml(JSON.stringify(bible, null, 2))}</textarea>
      </label>
    `;
    return;
  }

  elements.storyBibleView.innerHTML = `
    <div class="chapter-actions">
      <span class="helper-text">현재 플롯과 설정 정리</span>
      <div class="button-row">
        <button class="ghost-button" type="button" data-action="edit-bible">JSON 편집</button>
        <button class="ghost-button" type="button" data-action="refresh-bible">AI로 다시 정리</button>
      </div>
    </div>

    <section class="info-card">
      <span class="label">아크(Arc) 요약</span>
      ${renderList(bible.arc_summaries || [], (arc) => `
        <li>
          <strong>${escapeHtml(arc.arc_name)} (챕터 ${escapeHtml(arc.chapter_range)})</strong>
          <p>${escapeHtml(arc.summary)}</p>
        </li>
      `)}
    </section>
    <section class="info-card">
      <span class="label">현재 플롯 상태</span>
      <p>${escapeHtml(bible.current_plot_state || "아직 정리되지 않았습니다.")}</p>
    </section>
    <section class="info-card">
      <span class="label">작품 개요</span>
      <p>${escapeHtml(bible.core_premise || state.currentProject.config.request || "")}</p>
    </section>
    <section class="info-card">
      <span class="label">인물</span>
      ${renderList(bible.characters || [], (character) => `
        <li>
          <strong>${escapeHtml(character.name)}</strong>
          <span>${escapeHtml(character.role || "")} · ${escapeHtml(character.status || "")}</span>
        </li>
      `)}
    </section>
    <section class="info-card">
      <span class="label">플롯 스레드</span>
      ${renderList(bible.plot_threads || [], (thread) => `
        <li>
          <strong>${escapeHtml(thread.label || "")}</strong>
          <span>${escapeHtml(thread.status || "")}</span>
          <p>${escapeHtml(thread.note || "")}</p>
        </li>
      `)}
    </section>
    <section class="info-card">
      <span class="label">장소</span>
      ${renderList(bible.locations || [], (location) => `
        <li>
          <strong>${escapeHtml(location.name || "")}</strong>
          <span>${escapeHtml(location.description || "")}</span>
        </li>
      `)}
    </section>
    <section class="info-card">
      <span class="label">미해결 질문</span>
      ${renderList(bible.unresolved_questions || [], (item) => `<li><span>${escapeHtml(item)}</span></li>`)}
    </section>
    <section class="info-card">
      <span class="label">최근 저장본</span>
      ${renderHistoryEntries()}
    </section>
  `;
}

function readChapterEditorPayload(chapter) {
  return {
    chapterTitle: document.querySelector("#chapterTitleEdit").value.trim(),
    chapterSummary: document.querySelector("#chapterSummaryEdit").value.trim(),
    nextHook: document.querySelector("#chapterHookEdit").value.trim(),
    chapterText: document.querySelector("#chapterTextEdit").value.trim(),
    metadata: {
      timeOfDay: document.querySelector("#chapterTimeEdit").value.trim(),
      location: document.querySelector("#chapterLocationEdit").value.trim(),
      pov: chapter.metadata.pov,
      pacing: chapter.metadata.pacing,
      genreFramework: chapter.metadata.genreFramework,
      genreTags: chapter.metadata.genreTags
    }
  };
}

function getSelectedChapter() {
  if (!state.currentProject || !Array.isArray(state.currentProject.chapters)) {
    return null;
  }

  const selectedNumber = ensureSelectedChapter();
  return state.currentProject.chapters.find((chapter) => chapter.chapterNumber === selectedNumber) || null;
}

function ensureSelectedChapter() {
  const chapters = state.currentProject && Array.isArray(state.currentProject.chapters) ? state.currentProject.chapters : [];
  const existing = chapters.find((chapter) => chapter.chapterNumber === state.selectedChapterNumber);
  if (existing) {
    return existing.chapterNumber;
  }

  state.selectedChapterNumber = chapters.length ? chapters[chapters.length - 1].chapterNumber : null;
  return state.selectedChapterNumber;
}

function getLatestChapterNumber(project) {
  return project && Array.isArray(project.chapters) && project.chapters.length
    ? project.chapters[project.chapters.length - 1].chapterNumber
    : null;
}

function renderList(items, renderItem) {
  if (!items.length) {
    return `<div class="empty-state compact">항목이 없습니다.</div>`;
  }

  return `<ul class="info-list">${items.map(renderItem).join("")}</ul>`;
}

function renderHistoryEntries() {
  if (!state.historyEntries.length) {
    return `<div class="empty-state compact">아직 저장본이 없습니다.</div>`;
  }

  return `
    <div class="history-list">
      ${state.historyEntries.slice(0, 8).map((entry) => `
        <div class="history-item">
          <div>
            <strong>${escapeHtml(entry.reason || "save")}</strong>
            <p>${escapeHtml(formatDateTime(entry.createdAt))}</p>
          </div>
          <button class="ghost-button mini-button" type="button" data-action="restore-history" data-history-id="${escapeAttribute(entry.id)}">
            복원
          </button>
        </div>
      `).join("")}
    </div>
  `;
}

function showLoading(message) {
  elements.loadingMessage.textContent = message || "작업 중입니다.";
  elements.loadingOverlay.classList.add("visible");
  elements.loadingOverlay.setAttribute("aria-hidden", "false");
}

function hideLoading() {
  elements.loadingOverlay.classList.remove("visible");
  elements.loadingOverlay.setAttribute("aria-hidden", "true");
}

function setStatus(message, tone) {
  elements.statusBox.className = `status-box ${tone}`;
  elements.statusBox.textContent = message;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json"
    },
    ...options
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "요청 처리 중 오류가 발생했습니다.");
  }

  return data;
}

function slugify(value) {
  return String(value || "project")
    .trim()
    .toLowerCase()
    .replace(/[^\w\u3131-\uD79D-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "project";
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "시간 정보 없음";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#96;");
}
