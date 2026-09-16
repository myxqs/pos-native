/* global document, fetch */

export async function createPageRequest(apiFetch, title) {
  return requestJson(apiFetch, "/api/v1/pages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });
}

export async function updatePageRequest(apiFetch, id, title) {
  return requestJson(apiFetch, `/api/v1/pages/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });
}

async function requestJson(apiFetch, url, options) {
  const response = await apiFetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "request failed");
  return body;
}

async function start() {
  const form = document.querySelector("#create-page");
  const newTitle = document.querySelector("#new-page-title");
  const pageTitle = document.querySelector("#page-title");
  const save = document.querySelector("#save-page");
  const list = document.querySelector("#page-list");
  const editor = document.querySelector("#editor");
  const empty = document.querySelector("#empty-state");
  const status = document.querySelector("#status");
  let selectedId = null;

  async function refresh() {
    const response = await fetch("/api/v1/pages");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "could not load pages");
    list.replaceChildren(
      ...body.pages.map((page) => {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = page.title;
        button.addEventListener("click", () => {
          selectedId = page.id;
          pageTitle.value = page.title;
          editor.hidden = false;
          empty.hidden = true;
        });
        item.append(button);
        return item;
      }),
    );
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const result = await createPageRequest(fetch, newTitle.value);
      newTitle.value = "";
      selectedId = result.page.id;
      pageTitle.value = result.page.title;
      editor.hidden = false;
      empty.hidden = true;
      status.textContent = "Page created.";
      await refresh();
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : "Create failed.";
    }
  });

  save.addEventListener("click", async () => {
    if (!selectedId) return;
    try {
      await updatePageRequest(fetch, selectedId, pageTitle.value);
      status.textContent = "Page saved.";
      await refresh();
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : "Save failed.";
    }
  });

  try {
    await refresh();
  } catch (error) {
    status.textContent =
      error instanceof Error ? error.message : "NativePOS is unavailable.";
  }
}

if (typeof document !== "undefined") void start();
