"use strict";

const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");
const { promises: fs } = require("node:fs");

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const PROJECTS_DIR = path.join(ROOT_DIR, "data", "projects");
const HISTORY_DIR = path.join(ROOT_DIR, "data", "history");
const PORT = Number(process.env.PORT || 3000);

// Basic Auth Password (In real world, use environment variable)
const DEPLOY_PASSWORD = process.env.DEPLOY_PASSWORD || "gemini123";

const DEFAULT_MODEL = "gemini-3.1-pro-preview";
const LAST_SCENE_CONTEXT_SIZE = 2000;
const MAX_HISTORY_FILES = 30;
const NOVEL_RESPONSE_TAG = "novel_response";

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8"
};

const NOVEL_SYSTEM_PROMPT = `## ENTRY [0]: NOVEL_CORE CENTRAL COMMAND
Priority: **[HIGHEST]** | Always Active
@@depth 4

### 🎭 YOUR ROLE
당신은 문장의 리듬과 호흡을 조율하는 **전문 소설가**입니다.
단순한 정보 전달자가 아닌, 독자의 감각을 자극하는 '글의 예술가'로서 행동하십시오.

**STYLE UPGRADE: ANTI-STIFFNESS PROTOCOL**
- **문장 종결의 변주**: 모든 문장을 '~했다. ~였다.'로 끝내지 마십시오. 체언 종결(명사형 마무리), '~한다'의 현재형 서술, 의문형, 감탄형, 생략법 등을 적절히 섞어 리듬감을 만드십시오.
- **보여주기(Show), 말하지 않기(Don't Tell)**: "그는 슬펐다"라고 하지 말고, "그의 눈 밑이 파르르 떨리며 고인 물이 툭 떨어졌다"라고 묘사하십시오.
- **비유와 상징**: 감각적인 형용사보다 구체적인 동사와 비유를 사용하십시오. (예: '무겁다' 대신 '어깨 위에 젖은 솜덩이가 올라앉은 듯한')
- **단조로움 타파**: 짧은 문장과 긴 문장의 호흡을 교차하여 독자가 글의 속도감을 느끼게 하십시오.

---

### 📋 MASTER REFERENCE

| Aspect | Rule | Example |
|--------|------|---------|
| Pacing | 호흡 조절 | "심장 소리. 터질 듯한 고요. 그리고 비명." (단문/체언 활용) |
| Dialogue | 서브텍스트 | "차 마시러 왔나?" (의미: 당장 나가라.) |
| Description | 오감의 전이 | "비린 바람이 목덜미를 핥고 지나갔다." |
| Sentence Ending | 평서문 탈피 | "어둠이 내린 숲. 그곳엔 정적만이 감돌 뿐이었다." |

---

### 📋 NARRATIVE-LOCKED: EMOTION & PSYCHOLOGY
"감정은 단어로 나타나지 않는다. 인물의 사소한 행동, 시선의 방향, 호흡의 깊이에서 독자가 감정을 '추론'하게 하라. 문장이 딱딱해지는 순간 서사는 죽는다."

---

<output_format_spec>
Response MUST be a valid XML block named <${NOVEL_RESPONSE_TAG}> containing a single JSON object strictly enclosed within a CDATA section.
Return no markdown, no explanation, and no text before or after the XML block.

The JSON object inside CDATA MUST follow this exact schema:
{
  "chapter_number": integer,
  "chapter_title": string,
  "chapter_text": string,
  "chapter_summary": string,
  "next_hook": string,
  "metadata": {
    "time_of_day": string,
    "location": string,
    "pov": string,
    "pacing": string,
    "genre_tags": string[],
    "genre_framework": string
  }
}

Rules:
- "chapter_text" must contain only the prose of the chapter.
- "chapter_summary" must summarize the chapter in 2-4 sentences.
- "next_hook" must describe the unresolved pull toward the next chapter.
- Never emit the literal sequence "]]>" inside any JSON string value.
- Escape JSON correctly. Use double quotes for all JSON keys and string values.
</output_format_spec>

---

### ✅ INTERNAL VALIDATION (Apply silently — never include in output)

□ 문장의 끝이 3회 이상 동일한 어미(예: ~했다)로 반복되지 않는가?
□ 인물의 심리를 직접 기술하는 대신 행동과 환경으로 묘사했는가?
□ 문장의 길이가 단조롭지 않고 리듬이 느껴지는가?
□ '층층이', '영혼', '깊은' 같은 상투적인 추상 표현을 구체적인 감각으로 대체했는가?

⚠️ 하나라도 체크되지 않는다면 출력 전 문장을 전면 재구성하십시오.`;

const STORY_BIBLE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    project_title: { type: "string" },
    core_premise: { type: "string" },
    genre_tags: { type: "array", items: { type: "string" } },
    viewpoint: { type: "string" },
    pacing: { type: "string" },
    latest_time_of_day: { type: "string" },
    latest_location: { type: "string" },
    current_plot_state: { type: "string" },
    characters: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          role: { type: "string" },
          status: { type: "string" },
          desire: { type: "string" },
          tension: { type: "string" },
          last_known_location: { type: "string" }
        },
        required: ["name", "role", "status", "desire", "tension", "last_known_location"]
      }
    },
    plot_threads: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string" },
          status: { type: "string" },
          note: { type: "string" }
        },
        required: ["label", "status", "note"]
      }
    },
    locations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          current_status: { type: "string" }
        },
        required: ["name", "description", "current_status"]
      }
    },
    unresolved_questions: { type: "array", items: { type: "string" } },
    chapter_summaries: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          chapter_number: { type: "integer" },
          summary: { type: "string" },
          time_of_day: { type: "string" },
          location: { type: "string" }
        },
        required: ["chapter_number", "summary", "time_of_day", "location"]
      }
    }
  },
  required: [
    "project_title",
    "core_premise",
    "genre_tags",
    "viewpoint",
    "pacing",
    "latest_time_of_day",
    "latest_location",
    "current_plot_state",
    "characters",
    "plot_threads",
    "locations",
    "unresolved_questions",
    "chapter_summaries"
  ]
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  await fs.mkdir(PROJECTS_DIR, { recursive: true });
  await fs.mkdir(HISTORY_DIR, { recursive: true });
  const server = http.createServer(handleRequest);
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Novel Maker listening on http://0.0.0.0:${PORT}`);
    console.log(`Please use the provided URL or configure your cloud provider.`);
  });
}

async function handleRequest(req, res) {
  try {
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    
    // Auth Middleware
    const isLoginPage = requestUrl.pathname === "/login" || requestUrl.pathname === "/login.html" || requestUrl.pathname === "/api/login";
    const isAsset = requestUrl.pathname.endsWith(".css") || requestUrl.pathname.endsWith(".svg");
    
    if (!isLoginPage && !isAsset && !isAuthenticated(req)) {
      if (requestUrl.pathname.startsWith("/api/")) {
        return sendJson(res, 401, { error: "Unauthorized" });
      }
      res.writeHead(302, { Location: "/login.html" });
      res.end();
      return;
    }

    if (requestUrl.pathname === "/api/login" && req.method === "POST") {
      const payload = await readJsonBody(req);
      if (payload.password === DEPLOY_PASSWORD) {
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Set-Cookie": `auth=true; Path=/; HttpOnly; Max-Age=${60 * 60 * 24 * 7}` // 7 days
        });
        res.end(JSON.stringify({ ok: true }));
      } else {
        sendJson(res, 401, { error: "비밀번호가 틀렸습니다." });
      }
      return;
    }

    if (requestUrl.pathname.startsWith("/api/")) {
      await routeApi(req, res, requestUrl);
      return;
    }

    await serveStatic(requestUrl.pathname, res);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: error.message || "Internal server error" });
  }
}

function isAuthenticated(req) {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return false;
  return cookieHeader.includes("auth=true");
}

async function routeApi(req, res, requestUrl) {
  const method = req.method || "GET";
  const pathName = requestUrl.pathname;

  if (method === "GET" && pathName === "/api/projects") {
    sendJson(res, 200, { projects: await listProjects() });
    return;
  }

  if (method === "POST" && pathName === "/api/projects") {
    const payload = await readJsonBody(req);
    sendJson(res, 201, { project: await createProject(payload) });
    return;
  }

  if (method === "POST" && pathName === "/api/projects/import") {
    const payload = await readJsonBody(req);
    sendJson(res, 201, { project: await importProject(payload) });
    return;
  }

  const projectMatch = pathName.match(/^\/api\/projects\/([A-Za-z0-9-]+)$/);
  if (projectMatch) {
    if (method === "GET") {
      sendJson(res, 200, { project: await readProject(projectMatch[1]) });
      return;
    }

    if (method === "PATCH") {
      const payload = await readJsonBody(req);
      sendJson(res, 200, { project: await updateProjectMeta(projectMatch[1], payload) });
      return;
    }

    if (method === "DELETE") {
      await deleteProject(projectMatch[1]);
      sendJson(res, 200, { ok: true });
      return;
    }
  }

  const historyMatch = pathName.match(/^\/api\/projects\/([A-Za-z0-9-]+)\/history$/);
  if (method === "GET" && historyMatch) {
    sendJson(res, 200, { entries: await listProjectHistory(historyMatch[1]) });
    return;
  }

  const restoreHistoryMatch = pathName.match(/^\/api\/projects\/([A-Za-z0-9-]+)\/history\/([A-Za-z0-9-]+\.json)\/restore$/);
  if (method === "POST" && restoreHistoryMatch) {
    sendJson(res, 200, {
      project: await restoreProjectHistory(restoreHistoryMatch[1], restoreHistoryMatch[2])
    });
    return;
  }

  const continueMatch = pathName.match(/^\/api\/projects\/([A-Za-z0-9-]+)\/continue$/);
  if (method === "POST" && continueMatch) {
    const payload = await readJsonBody(req);
    sendJson(res, 200, { project: await continueProject(continueMatch[1], payload) });
    return;
  }

  const refreshBibleMatch = pathName.match(/^\/api\/projects\/([A-Za-z0-9-]+)\/story-bible$/);
  if (refreshBibleMatch) {
    if (method === "POST") {
      const payload = await readJsonBody(req);
      sendJson(res, 200, { project: await refreshStoryBible(refreshBibleMatch[1], payload) });
      return;
    }

    if (method === "PATCH") {
      const payload = await readJsonBody(req);
      sendJson(res, 200, { project: await saveStoryBible(refreshBibleMatch[1], payload) });
      return;
    }
  }

  const chapterMatch = pathName.match(/^\/api\/projects\/([A-Za-z0-9-]+)\/chapters\/(\d+)$/);
  if (method === "PATCH" && chapterMatch) {
    const payload = await readJsonBody(req);
    sendJson(res, 200, {
      project: await updateChapter(chapterMatch[1], Number(chapterMatch[2]), payload)
    });
    return;
  }

  const regenerateMatch = pathName.match(/^\/api\/projects\/([A-Za-z0-9-]+)\/chapters\/(\d+)\/regenerate$/);
  if (method === "POST" && regenerateMatch) {
    const payload = await readJsonBody(req);
    sendJson(res, 200, {
      project: await regenerateChapter(regenerateMatch[1], Number(regenerateMatch[2]), payload)
    });
    return;
  }

  sendJson(res, 404, { error: "Route not found" });
}

async function createProject(payload) {
  const apiKey = resolveApiKey(payload.apiKey);
  const config = normalizeProjectConfig(payload);
  const project = {
    id: crypto.randomUUID(),
    title: config.title,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    config,
    chapters: [],
    storyBible: buildEmptyStoryBible(config)
  };

  const chapter = await generateOpeningChapter(project, apiKey);
  project.chapters.push(chapter);
  project.storyBible = await safeUpdateStoryBible(project, chapter, apiKey);
  project.updatedAt = new Date().toISOString();
  await writeProject(project);
  return project;
}

async function importProject(payload) {
  if (!payload || !payload.id || !payload.title || !Array.isArray(payload.chapters)) {
    throw new Error("유효하지 않은 프로젝트 데이터입니다.");
  }

  const project = {
    id: payload.id,
    title: payload.title,
    createdAt: payload.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    config: payload.config || { model: "gemini-3.1-pro-preview", title: payload.title, request: "", tags: [] },
    chapters: payload.chapters,
    storyBible: payload.storyBible || { 
      project_title: payload.title, core_premise: "", genre_tags: [], viewpoint: "", 
      pacing: "", latest_time_of_day: "", latest_location: "", current_plot_state: "", 
      characters: [], plot_threads: [], locations: [], unresolved_questions: [], chapter_summaries: [] 
    }
  };

  await writeProject(project, "import");
  return project;
}

async function continueProject(projectId, payload) {
  const apiKey = resolveApiKey(payload.apiKey);
  const project = await readProject(projectId);
  const chapter = await generateContinuationChapter(project, apiKey, payload.guidance || "");
  project.chapters.push(chapter);
  project.storyBible = await safeUpdateStoryBible(project, chapter, apiKey);
  project.updatedAt = new Date().toISOString();
  await writeProject(project);
  return project;
}

async function refreshStoryBible(projectId, payload) {
  const apiKey = resolveApiKey(payload.apiKey);
  const project = await readProject(projectId);
  const latestChapter = project.chapters.at(-1);
  if (!latestChapter) {
    throw new Error("스토리 바이블을 갱신할 챕터가 없습니다.");
  }

  project.storyBible = await safeUpdateStoryBible(project, latestChapter, apiKey);
  project.updatedAt = new Date().toISOString();
  await writeProject(project);
  return project;
}

async function updateProjectMeta(projectId, payload) {
  const project = await readProject(projectId);

  if (Object.prototype.hasOwnProperty.call(payload, "title")) {
    project.title = requiredString(payload.title, "title");
    project.config.title = project.title;
  }

  project.updatedAt = new Date().toISOString();
  await writeProject(project, "meta-update");
  return project;
}

async function deleteProject(projectId) {
  ensureSafeProjectId(projectId);
  await fs.rm(path.join(PROJECTS_DIR, `${projectId}.json`), { force: true });
  await fs.rm(path.join(HISTORY_DIR, projectId), { recursive: true, force: true });
}

async function listProjectHistory(projectId) {
  ensureSafeProjectId(projectId);
  const projectHistoryDir = path.join(HISTORY_DIR, projectId);
  const entries = await fs.readdir(projectHistoryDir, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .sort((left, right) => right.name.localeCompare(left.name))
    .map((entry) => {
      const match = entry.name.match(/^(\d+)-(.+)\.json$/);
      const createdAt = match ? new Date(Number(match[1])).toISOString() : "";
      const reason = match ? match[2].replace(/-/g, " ") : "save";

      return {
        id: entry.name,
        createdAt,
        reason
      };
    });
}

async function restoreProjectHistory(projectId, entryId) {
  ensureSafeProjectId(projectId);
  ensureSafeHistoryEntryId(entryId);

  const projectHistoryPath = path.join(HISTORY_DIR, projectId, entryId);
  const snapshotRaw = await fs.readFile(projectHistoryPath, "utf8").catch((error) => {
    if (error.code === "ENOENT") {
      throw new Error("복원할 저장본을 찾을 수 없습니다.");
    }
    throw error;
  });

  const snapshot = JSON.parse(snapshotRaw);
  if (!snapshot || typeof snapshot !== "object" || snapshot.id !== projectId) {
    throw new Error("저장본 데이터가 올바르지 않습니다.");
  }

  snapshot.updatedAt = new Date().toISOString();
  await writeProject(snapshot, "restore");
  return snapshot;
}

async function updateChapter(projectId, chapterNumber, payload) {
  const project = await readProject(projectId);
  const chapterIndex = project.chapters.findIndex((chapter) => chapter.chapterNumber === chapterNumber);

  if (chapterIndex === -1) {
    throw new Error("수정할 챕터를 찾을 수 없습니다.");
  }

  const current = project.chapters[chapterIndex];
  const next = {
    ...current,
    chapterTitle: Object.prototype.hasOwnProperty.call(payload, "chapterTitle")
      ? requiredString(payload.chapterTitle, "chapterTitle")
      : current.chapterTitle,
    chapterSummary: Object.prototype.hasOwnProperty.call(payload, "chapterSummary")
      ? requiredString(payload.chapterSummary, "chapterSummary")
      : current.chapterSummary,
    nextHook: Object.prototype.hasOwnProperty.call(payload, "nextHook")
      ? requiredString(payload.nextHook, "nextHook")
      : current.nextHook,
    chapterText: Object.prototype.hasOwnProperty.call(payload, "chapterText")
      ? requiredString(payload.chapterText, "chapterText")
      : current.chapterText,
    metadata: {
      ...current.metadata,
      ...(payload.metadata && typeof payload.metadata === "object"
        ? {
            timeOfDay: Object.prototype.hasOwnProperty.call(payload.metadata, "timeOfDay")
              ? requiredString(payload.metadata.timeOfDay, "metadata.timeOfDay")
              : current.metadata.timeOfDay,
            location: Object.prototype.hasOwnProperty.call(payload.metadata, "location")
              ? requiredString(payload.metadata.location, "metadata.location")
              : current.metadata.location,
            pov: Object.prototype.hasOwnProperty.call(payload.metadata, "pov")
              ? requiredString(payload.metadata.pov, "metadata.pov")
              : current.metadata.pov,
            pacing: Object.prototype.hasOwnProperty.call(payload.metadata, "pacing")
              ? requiredString(payload.metadata.pacing, "metadata.pacing")
              : current.metadata.pacing,
            genreFramework: Object.prototype.hasOwnProperty.call(payload.metadata, "genreFramework")
              ? requiredString(payload.metadata.genreFramework, "metadata.genreFramework")
              : current.metadata.genreFramework,
            genreTags: Object.prototype.hasOwnProperty.call(payload.metadata, "genreTags")
              ? normalizeStringArray(payload.metadata.genreTags)
              : current.metadata.genreTags
          }
        : {})
    },
    updatedAt: new Date().toISOString()
  };

  project.chapters[chapterIndex] = next;
  project.updatedAt = new Date().toISOString();
  await writeProject(project, `chapter-edit-${chapterNumber}`);
  return project;
}

async function regenerateChapter(projectId, chapterNumber, payload) {
  const apiKey = resolveApiKey(payload.apiKey);
  const project = await readProject(projectId);

  if (chapterNumber !== project.chapters.length) {
    throw new Error("현재는 마지막 화만 재생성할 수 있습니다.");
  }

  const chapter = await rewriteLatestChapter(project, apiKey, chapterNumber, payload.guidance || "");
  project.chapters[project.chapters.length - 1] = chapter;
  project.storyBible = await safeUpdateStoryBible(project, chapter, apiKey);
  project.updatedAt = new Date().toISOString();

  await writeProject(project, `chapter-regenerate-${chapterNumber}`);
  return project;
}

async function saveStoryBible(projectId, payload) {
  const project = await readProject(projectId);

  if (!payload.storyBible || typeof payload.storyBible !== "object" || Array.isArray(payload.storyBible)) {
    throw new Error("스토리 바이블 JSON 객체가 필요합니다.");
  }

  project.storyBible = normalizeManualStoryBible(payload.storyBible, project);
  project.updatedAt = new Date().toISOString();
  await writeProject(project, "story-bible-edit");
  return project;
}

async function generateOpeningChapter(project, apiKey) {
  const response = await callGemini({
    apiKey,
    model: project.config.model,
    instructions: NOVEL_SYSTEM_PROMPT,
    input: buildInitialUserPrompt(project.config)
  });
  const parsed = parseNovelPayload(extractGeminiText(response));
  return normalizeChapter(parsed.json, 1, parsed.xml);
}

async function generateContinuationChapter(project, apiKey, guidance) {
  const nextChapterNumber = project.chapters.length + 1;
  const response = await callGemini({
    apiKey,
    model: project.config.model,
    instructions: NOVEL_SYSTEM_PROMPT,
    input: buildContinuationPrompt(project, nextChapterNumber, guidance)
  });
  const parsed = parseNovelPayload(extractGeminiText(response));
  return normalizeChapter(parsed.json, nextChapterNumber, parsed.xml);
}

async function rewriteLatestChapter(project, apiKey, chapterNumber, guidance) {
  const response = await callGemini({
    apiKey,
    model: project.config.model,
    instructions: NOVEL_SYSTEM_PROMPT,
    input: buildRewritePrompt(project, chapterNumber, guidance)
  });
  const parsed = parseNovelPayload(extractGeminiText(response));
  return normalizeChapter(parsed.json, chapterNumber, parsed.xml);
}

async function safeUpdateStoryBible(project, chapter, apiKey) {
  try {
    return await updateStoryBible(project, chapter, apiKey);
  } catch (error) {
    console.warn("Story bible update failed, using fallback:", error.message);
    return buildFallbackStoryBible(project, chapter);
  }
}

async function updateStoryBible(project, chapter, apiKey) {
  const response = await callGemini({
    apiKey,
    model: project.config.model,
    input: buildStoryBiblePrompt(project, chapter),
    jsonSchema: {
      responseMimeType: "application/json",
      responseJsonSchema: STORY_BIBLE_SCHEMA
    }
  });
  const outputText = extractGeminiText(response);
  if (!outputText) {
    throw new Error("스토리 바이블 응답이 비어 있습니다.");
  }
  return JSON.parse(outputText);
}

async function callGemini({ apiKey, model, instructions, input, jsonSchema }) {
  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: input }]
      }
    ]
  };

  if (instructions) {
    body.system_instruction = {
      parts: [{ text: instructions }]
    };
  }

  if (jsonSchema) {
    body.generationConfig = jsonSchema;
  }

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error && data.error.message ? data.error.message : `Gemini request failed with status ${response.status}`;
    throw new Error(message);
  }

  return data;
}

function normalizeProjectConfig(payload) {
  const requestText = requiredString(payload.request, "소설 요청사항");
  const title = cleanString(payload.title) || deriveTitle(requestText);

  return {
    title,
    request: requestText,
    tags: splitMultiValue(payload.tags),
    pov: cleanString(payload.pov) || "3인칭 제한 시점",
    pacing: cleanString(payload.pacing) || "중간 호흡",
    genreFramework: cleanString(payload.genreFramework) || "자유 서사",
    chapterLength: cleanString(payload.chapterLength) || "1800~2600자",
    model: cleanString(payload.model) || DEFAULT_MODEL
  };
}

function buildInitialUserPrompt(config) {
  return `## ENTRY [1]: INITIAL_GENERATE_MODULE
Priority: **[HIGH]** | Activation: First Turn

### 📋 INPUT SPECS
- **태그:** [${stringOrFallback(config.tags.join(", "), "없음")}]
- **요청사항:** [${config.request}]

[시점 통제 모듈 삽입: ${config.pov}]
[호흡과 리듬 모듈 삽입: ${config.pacing}]
[장르 프레임워크 모듈 삽입: ${config.genreFramework}]
[권장 분량 힌트: ${config.chapterLength}]
[작품 제목 힌트: ${config.title}]

### 🎯 TASK: OPENING_CHAPTER
첫 문장부터 독자의 멱살을 잡고 끌고 가십시오. 배경 설명으로 시작하지 말고, 인물의 **결정적인 순간**이나 **강렬한 감각**으로 시작하십시오.

**SUCCESS CRITERIA:**
- '보여주기' 기법을 통해 배경을 자연스럽게 노출할 것.
- 문장의 끝을 변주하여 딱딱함을 제거할 것.
- 챕터의 끝에 다음 화를 보지 않고는 못 배길 상황을 만들 것.

### 추가 출력 지시
- chapter_number는 반드시 1로 설정하십시오.
- chapter_title은 작품 전체의 톤을 드러내는 강한 제목으로 지으십시오.
- metadata.pov는 "${config.pov}"를 반영하십시오.
- metadata.pacing은 "${config.pacing}"를 반영하십시오.
- metadata.genre_tags에는 태그를 배열로 넣으십시오.
- metadata.genre_framework에는 "${config.genreFramework}"를 넣으십시오.`;
}

function buildRecentChapterDigest(project, limit = 3) {
  const chapters = Array.isArray(project.chapters) ? project.chapters.slice(-limit) : [];
  if (!chapters.length) {
    return "- 최근 챕터 없음";
  }

  return chapters
    .map((chapter) => {
      return [
        `- ${chapter.chapterNumber}화`,
        `제목: ${chapter.chapterTitle}`,
        `요약: ${chapter.chapterSummary}`,
        `시간대: ${chapter.metadata.timeOfDay}`,
        `장소: ${chapter.metadata.location}`
      ].join(" | ");
    })
    .join("\n");
}

function buildPlotThreadDigest(project, limit = 5) {
  const plotThreads = Array.isArray(project.storyBible.plot_threads) ? project.storyBible.plot_threads.slice(0, limit) : [];
  if (!plotThreads.length) {
    return "- 활성 플롯 스레드 없음";
  }

  return plotThreads
    .map((thread) => `- ${thread.label || "스레드"} | 상태: ${thread.status || "미상"} | 메모: ${thread.note || ""}`)
    .join("\n");
}

function buildContinuationPrompt(project, nextChapterNumber, guidance) {
  const lastChapter = project.chapters.at(-1);
  const context = lastChapter ? lastChapter.chapterText.slice(-LAST_SCENE_CONTEXT_SIZE) : "";
  const userGuidance = cleanString(guidance) || "현재 플롯의 흐름에 따라 가장 개연성 있는 전개를 이어가십시오.";
  const recentChapterDigest = buildRecentChapterDigest(project);
  const plotThreadDigest = buildPlotThreadDigest(project);

  return `## ENTRY [1]: CONTINUATION_MODULE
Priority: **[HIGH]** | Activation: Ongoing

[스토리 바이블 모듈 삽입]
${JSON.stringify(project.storyBible, null, 2)}

[시점 통제 모듈 삽입: ${project.config.pov}]
[호흡과 리듬 모듈 삽입: ${project.config.pacing}]

### 🎯 MODULE: 에피소드 호흡 및 사건 통제 (Episode Pacing & Incident Control)
Priority: **[HIGH]**

**CRITICAL RULES:**
1. **사건의 강박에서 벗어날 것:** 매 AI 출력마다 반드시 새로운 사건(Incident)이나 위기가 발생할 필요는 없습니다. 사용자는 여러 번의 턴을 거쳐 이야기를 전개할 것을 전제로 하고 있습니다.
2. **사소한 사건 남발 금지:** 자잘하고 의미 없는 사건이 연속해서 터지는 것은 독자의 피로도를 급격히 높입니다.
3. **깊이 있는 서사:** 여러 개의 가벼운 사건을 빠르게 지나치는 것보다, **하나의 중요하고 긴밀한 사건**이나 **인물 간의 깊이 있는 상호작용(대화, 심리전, 분위기 묘사)**에 집중하는 것이 훨씬 훌륭한 전개입니다.
4. **빌드업의 시간:** 다음 전개를 위한 자연스러운 전환(Transition), 정보 수집, 일상적인 대화, 긴장감 조성을 위한 '쉬어가는 구간(Breathing Room)'을 충분히 허용하십시오.
5. **시간적 연속성(Temporal Continuity) 엄수:** 이전 화의 시간대(예: 저녁, 밤)를 정확히 파악하고, 의도적인 타임스킵(Time Skip)이 명시되지 않은 한 바로 이어지는 시간대로 서술을 시작하십시오. 갑자기 아침이 되는 등의 오류를 절대 방지하십시오.

### 최근 전개 요약
${recentChapterDigest}

### 활성 플롯 스레드
${plotThreadDigest}

### 📋 NEXT CHAPTER GUIDANCE
**사용자 가이드:** [${userGuidance}]

### 🎯 TASK: 제 [${nextChapterNumber}]장 집필
앞서 말한 **STYLE UPGRADE** 지침을 엄격히 준수하십시오. 평서문 반복은 금기입니다.

**NARRATIVE-LOCKED ANCHOR:**
"이전 챕터의 마지막 문장에서 이어지는 공기의 흐름을 포착하십시오. 인물의 감정선이 끊기지 않도록 하되, 문체는 한층 더 세련되게 다듬으십시오."

**직전 장면 문맥 (참고용):**
<![CDATA[
${context}
]]>

### 추가 출력 지시
- chapter_number는 반드시 ${nextChapterNumber}로 설정하십시오.
- metadata.pov는 "${project.config.pov}"를 반영하십시오.
- metadata.pacing은 "${project.config.pacing}"를 반영하십시오.
- metadata.genre_tags에는 ${JSON.stringify(project.config.tags)}를 넣으십시오.
- metadata.genre_framework에는 "${project.config.genreFramework}"를 넣으십시오.`;
}

function buildRewritePrompt(project, chapterNumber, guidance) {
  const targetChapter = project.chapters.find((chapter) => chapter.chapterNumber === chapterNumber);
  const previousChapter = project.chapters.find((chapter) => chapter.chapterNumber === chapterNumber - 1);
  const previousContext = previousChapter ? previousChapter.chapterText.slice(-LAST_SCENE_CONTEXT_SIZE) : "";
  const userGuidance = cleanString(guidance) || "기존 화의 핵심 사건은 유지하되 문장과 장면 설계를 더 좋게 다듬으십시오.";
  const recentChapterDigest = buildRecentChapterDigest(project);

  return `## ENTRY [2]: CHAPTER_REWRITE_MODULE
Priority: **[HIGH]** | Activation: Manual Rewrite

[스토리 바이블 모듈 삽입]
${JSON.stringify(project.storyBible, null, 2)}

[시점 통제 모듈 삽입: ${project.config.pov}]
[호흡과 리듬 모듈 삽입: ${project.config.pacing}]

### 현재 화 정보
- 챕터 번호: ${chapterNumber}
- 현재 제목: ${targetChapter ? targetChapter.chapterTitle : ""}
- 현재 요약: ${targetChapter ? targetChapter.chapterSummary : ""}
- 현재 갈고리: ${targetChapter ? targetChapter.nextHook : ""}

### 최근 전개 요약
${recentChapterDigest}

### 이전 장면 문맥
<![CDATA[
${previousContext}
]]>

### 기존 본문
<![CDATA[
${targetChapter ? targetChapter.chapterText : ""}
]]>

### 사용자 가이드
${userGuidance}

### TASK
현재 화를 같은 번호의 챕터로 다시 쓰십시오.
이전 화와의 연속성은 유지하되, 문장력과 장면 밀도를 높이십시오.

### 추가 출력 지시
- chapter_number는 반드시 ${chapterNumber}로 설정하십시오.
- metadata.pov는 "${project.config.pov}"를 반영하십시오.
- metadata.pacing은 "${project.config.pacing}"를 반영하십시오.
- metadata.genre_tags에는 ${JSON.stringify(project.config.tags)}를 넣으십시오.
- metadata.genre_framework에는 "${project.config.genreFramework}"를 넣으십시오.`;
}

function buildStoryBiblePrompt(project, chapter) {
  return `Update the Story Bible based on this chapter (Index: ${chapter.chapterNumber}).
Previous: ${JSON.stringify(project.storyBible, null, 2)}
Chapter: ${chapter.chapterText}

Keep continuity with the previous story bible.
Reflect only facts, active tensions, and clearly implied next steps from the chapter.
Do not invent new characters or locations unless the chapter introduces them.
Limit each list to the most relevant items so the bible stays compact and useful.
Preserve unresolved questions unless they were clearly answered in the latest chapter.`;
}

function parseNovelPayload(rawText) {
  const text = (rawText || "").trim();
  if (!text) throw new Error("모델이 빈 응답을 반환했습니다.");

  const xmlPattern = new RegExp(`<${NOVEL_RESPONSE_TAG}>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${NOVEL_RESPONSE_TAG}>`);
  const xmlMatch = text.match(xmlPattern);
  if (xmlMatch) {
    return { xml: xmlMatch[0].trim(), json: JSON.parse(xmlMatch[1].trim()) };
  }

  const genericCdataMatch = text.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  if (genericCdataMatch) {
    return { xml: text, json: JSON.parse(genericCdataMatch[1].trim()) };
  }

  try {
    return { xml: text, json: JSON.parse(text) };
  } catch {
    const extracted = extractFirstJsonObject(text);
    if (extracted) {
      return { xml: text, json: JSON.parse(extracted) };
    }
    throw new Error("모델 응답에서 챕터 JSON을 추출할 수 없습니다.");
  }
}

function normalizeChapter(rawChapter, expectedNumber, rawXml) {
  if (!rawChapter || typeof rawChapter !== "object") {
    throw new Error("챕터 JSON 형식이 올바르지 않습니다.");
  }

  const metadata = rawChapter.metadata && typeof rawChapter.metadata === "object" ? rawChapter.metadata : {};
  return {
    chapterNumber: expectedNumber,
    chapterTitle: requiredString(rawChapter.chapter_title, "chapter_title"),
    chapterText: requiredString(rawChapter.chapter_text, "chapter_text"),
    chapterSummary: requiredString(rawChapter.chapter_summary, "chapter_summary"),
    nextHook: requiredString(rawChapter.next_hook, "next_hook"),
    metadata: {
      timeOfDay: cleanString(metadata.time_of_day) || "미상",
      location: cleanString(metadata.location) || "미상",
      pov: cleanString(metadata.pov) || "미상",
      pacing: cleanString(metadata.pacing) || "미상",
      genreTags: Array.isArray(metadata.genre_tags) ? metadata.genre_tags.map(String) : [],
      genreFramework: cleanString(metadata.genre_framework) || "미상"
    },
    rawXml,
    createdAt: new Date().toISOString()
  };
}

function buildFallbackStoryBible(project, chapter) {
  const existingSummaries = Array.isArray(project.storyBible.chapter_summaries)
    ? project.storyBible.chapter_summaries.filter((item) => item.chapter_number !== chapter.chapterNumber)
    : [];

  const locations = chapter.metadata.location && chapter.metadata.location !== "미상"
    ? [{
        name: chapter.metadata.location,
        description: "최근 장면의 핵심 무대",
        current_status: "활성"
      }]
    : [];

  return {
    project_title: project.title,
    core_premise: project.config.request,
    genre_tags: project.config.tags,
    viewpoint: project.config.pov,
    pacing: project.config.pacing,
    latest_time_of_day: chapter.metadata.timeOfDay,
    latest_location: chapter.metadata.location,
    current_plot_state: chapter.chapterSummary,
    characters: Array.isArray(project.storyBible.characters) ? project.storyBible.characters : [],
    plot_threads: [{
      label: chapter.chapterTitle,
      status: "active",
      note: chapter.nextHook
    }],
    locations,
    unresolved_questions: [chapter.nextHook],
    chapter_summaries: [
      ...existingSummaries,
      {
        chapter_number: chapter.chapterNumber,
        summary: chapter.chapterSummary,
        time_of_day: chapter.metadata.timeOfDay,
        location: chapter.metadata.location
      }
    ]
  };
}

function buildEmptyStoryBible(config) {
  return {
    project_title: config.title,
    core_premise: config.request,
    genre_tags: config.tags,
    viewpoint: config.pov,
    pacing: config.pacing,
    latest_time_of_day: "",
    latest_location: "",
    current_plot_state: "",
    characters: [],
    plot_threads: [],
    locations: [],
    unresolved_questions: [],
    chapter_summaries: []
  };
}

function extractGeminiText(responseData) {
  if (responseData.promptFeedback && responseData.promptFeedback.blockReason) {
    throw new Error(`Gemini blocked the prompt: ${responseData.promptFeedback.blockReason}`);
  }

  const chunks = [];
  const candidates = Array.isArray(responseData.candidates) ? responseData.candidates : [];
  for (const candidate of candidates) {
    if (candidate.finishReason && candidate.finishReason !== "STOP" && candidate.finishReason !== "MAX_TOKENS") {
      continue;
    }

    const parts = candidate.content && Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
    for (const part of parts) {
      if (typeof part.text === "string") {
        chunks.push(part.text);
      }
    }
  }

  const text = chunks.join("\n").trim();
  if (text) {
    return text;
  }

  const finishReason = candidates[0] && candidates[0].finishReason ? candidates[0].finishReason : "";
  if (finishReason) {
    throw new Error(`Gemini response is empty. finishReason=${finishReason}`);
  }

  throw new Error("Gemini response is empty.");
}

async function listProjects() {
  const files = await fs.readdir(PROJECTS_DIR, { withFileTypes: true });
  const summaries = [];

  for (const entry of files) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const project = JSON.parse(await fs.readFile(path.join(PROJECTS_DIR, entry.name), "utf8"));
    summaries.push({
      id: project.id,
      title: project.title,
      updatedAt: project.updatedAt,
      tags: Array.isArray(project.config && project.config.tags) ? project.config.tags : [],
      chapterCount: Array.isArray(project.chapters) ? project.chapters.length : 0,
      lastChapterTitle: project.chapters && project.chapters.length ? project.chapters.at(-1).chapterTitle : "",
      currentPlotState: project.storyBible && project.storyBible.current_plot_state ? project.storyBible.current_plot_state : ""
    });
  }

  summaries.sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt));
  return summaries;
}

async function readProject(projectId) {
  ensureSafeProjectId(projectId);
  const filePath = path.join(PROJECTS_DIR, `${projectId}.json`);
  const file = await fs.readFile(filePath, "utf8").catch((error) => {
    if (error.code === "ENOENT") throw new Error("프로젝트를 찾을 수 없습니다.");
    throw error;
  });
  return JSON.parse(file);
}

async function writeProject(project, reason = "save") {
  ensureSafeProjectId(project.id);
  const filePath = path.join(PROJECTS_DIR, `${project.id}.json`);
  const json = JSON.stringify(project, null, 2);

  await fs.writeFile(filePath, json, "utf8");
  await writeProjectHistory(project.id, json, reason);
}

async function writeProjectHistory(projectId, json, reason) {
  const projectHistoryDir = path.join(HISTORY_DIR, projectId);
  await fs.mkdir(projectHistoryDir, { recursive: true });

  const safeReason = String(reason || "save")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "save";

  await fs.writeFile(path.join(projectHistoryDir, `${Date.now()}-${safeReason}.json`), json, "utf8");

  const historyFiles = (await fs.readdir(projectHistoryDir))
    .filter((entry) => entry.endsWith(".json"))
    .sort();

  const overflow = historyFiles.length - MAX_HISTORY_FILES;
  if (overflow > 0) {
    for (const entry of historyFiles.slice(0, overflow)) {
      await fs.rm(path.join(projectHistoryDir, entry), { force: true });
    }
  }
}

async function serveStatic(requestPath, res) {
  const cleanPath = requestPath === "/" ? "/index.html" : requestPath;
  const resolvedPath = path.normalize(path.join(PUBLIC_DIR, cleanPath));

  if (!resolvedPath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  const content = await fs.readFile(resolvedPath).catch(async (error) => {
    if (error.code !== "ENOENT") throw error;
    return fs.readFile(path.join(PUBLIC_DIR, "index.html"));
  });

  const extension = path.extname(resolvedPath) || ".html";
  res.writeHead(200, { "Content-Type": MIME_TYPES[extension] || "application/octet-stream" });
  res.end(content);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("JSON 요청 본문을 해석할 수 없습니다.");
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function resolveApiKey(apiKeyFromRequest) {
  const key = cleanString(apiKeyFromRequest) || cleanString(process.env.GEMINI_API_KEY);
  if (!key) {
    throw new Error("Gemini API 키가 필요합니다. UI에 입력하거나 GEMINI_API_KEY 환경 변수를 설정하세요.");
  }
  return key;
}

function splitMultiValue(value) {
  return String(value || "")
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [];
}

function normalizeManualStoryBible(storyBible, project) {
  return {
    project_title: cleanString(storyBible.project_title) || project.title,
    core_premise: cleanString(storyBible.core_premise) || project.config.request,
    genre_tags: normalizeStringArray(storyBible.genre_tags || project.config.tags),
    viewpoint: cleanString(storyBible.viewpoint) || project.config.pov,
    pacing: cleanString(storyBible.pacing) || project.config.pacing,
    latest_time_of_day: cleanString(storyBible.latest_time_of_day),
    latest_location: cleanString(storyBible.latest_location),
    current_plot_state: cleanString(storyBible.current_plot_state),
    characters: Array.isArray(storyBible.characters) ? storyBible.characters : [],
    plot_threads: Array.isArray(storyBible.plot_threads) ? storyBible.plot_threads : [],
    locations: Array.isArray(storyBible.locations) ? storyBible.locations : [],
    unresolved_questions: normalizeStringArray(storyBible.unresolved_questions),
    chapter_summaries: Array.isArray(storyBible.chapter_summaries) ? storyBible.chapter_summaries : []
  };
}

function deriveTitle(requestText) {
  const compact = requestText.replace(/\s+/g, " ").trim();
  return compact.length > 24 ? `${compact.slice(0, 24)}...` : compact;
}

function stringOrFallback(value, fallback) {
  return value && value.trim() ? value : fallback;
}

function extractFirstJsonObject(value) {
  const text = String(value || "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return "";
  }
  return text.slice(start, end + 1);
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function requiredString(value, label) {
  const text = cleanString(value);
  if (!text) throw new Error(`${label} 값이 비어 있습니다.`);
  return text;
}

function ensureSafeProjectId(projectId) {
  if (!/^[A-Za-z0-9-]+$/.test(projectId)) {
    throw new Error("잘못된 프로젝트 ID입니다.");
  }
}

function ensureSafeHistoryEntryId(entryId) {
  if (!/^[A-Za-z0-9-]+\.json$/.test(entryId)) {
    throw new Error("잘못된 저장본 ID입니다.");
  }
}
