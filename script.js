const form = document.querySelector('#request-form');
const formTitle = document.querySelector('#form-title');
const formMessage = document.querySelector('#form-message');
const listMessage = document.querySelector('#list-message');
const submitButton = document.querySelector('#submit-button');
const cancelEdit = document.querySelector('#cancel-edit');
const viewRequests = document.querySelector('#view-requests');
const dashboardMessage = document.querySelector('#dashboard-message');
const search = document.querySelector('#search');
const filter = document.querySelector('#filter');
const list = document.querySelector('#request-list');
const emptyMessage = document.querySelector('#empty-message');
const cardTemplate = document.querySelector('#request-card');
const attachment = document.querySelector('#attachment');
const attachmentHelp = document.querySelector('#attachment-help');

const maxFileSize = 1024 * 1024;
const attachmentHint = 'PDF or Word (.doc, .docx), up to 1 MB. Files are saved in this browser.';
const nextStatus = {
  Submitted: 'Printing',
  Printing: 'Ready for pickup'
};
let requests = [];
let editingId = null;

function showMessage(element, text, isError = false) {
  element.textContent = text;
  element.classList.toggle('error', isError);
}

// All three pages share the same browser storage.
const storageKey = 'campus-print-requests';

function loadRequests() {
  return JSON.parse(localStorage.getItem(storageKey)) ?? [];
}

function saveRequests(updatedRequests) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(updatedRequests));
    requests = updatedRequests;
  } catch {
    throw new Error('Could not save in this browser. Check storage settings or try a smaller file.');
  }
}

function refreshRequests() {
  requests = loadRequests();
  if (dashboardMessage) renderDashboard();
  if (list) renderRequests();
}

function renderDashboard() {
  document.querySelector('#total').textContent = requests.length;
  document.querySelector('#submitted').textContent = countStatus('Submitted');
  document.querySelector('#printing').textContent = countStatus('Printing');
  document.querySelector('#ready').textContent = countStatus('Ready for pickup');
}

function renderRequests() {
  const query = search.value.trim().toLowerCase();
  const visibleRequests = requests.filter(request => {
    const searchableText = [request.id, request.student, request.studentId, request.document].join(' ').toLowerCase();
    const matchesSearch = searchableText.includes(query);
    const matchesStatus = !filter.value || request.status === filter.value;
    return matchesSearch && matchesStatus;
  });

  list.replaceChildren();
  emptyMessage.hidden = requests.length > 0;
  document.querySelector('#no-results').hidden = !requests.length || visibleRequests.length > 0;

  for (const request of visibleRequests) {
    list.append(createCard(request));
  }
}

function countStatus(status) {
  return requests.filter(request => request.status === status).length;
}

function createCard(request) {
  const card = cardTemplate.content.firstElementChild.cloneNode(true);
  card.dataset.id = request.id;
  card.querySelector('.request-id').textContent = request.id;
  card.querySelector('h3').textContent = request.document;
  const student = request.studentId ? `${request.student} (ID: ${request.studentId})` : request.student;
  card.querySelector('.details').textContent =
    `${student} · ${request.copies} ${request.copies === 1 ? 'copy' : 'copies'} · ${request.mode} · ${request.paperSize ?? "A4"} · ${request.sides === 'two' ? 'Both sides' : 'One side'}`;

  const badge = card.querySelector('.badge');
  badge.textContent = request.status;
  badge.dataset.status = request.status;

  const advance = card.querySelector('.advance');
  advance.hidden = !nextStatus[request.status];
  advance.textContent = request.status === 'Submitted' ? 'Start printing' : 'Mark ready';

  card.querySelector('.edit').href = `submit.html?edit=${encodeURIComponent(request.id)}`;
  if (request.attachment) {
    const download = card.querySelector('.download');
    download.href = request.attachment.url;
    download.download = request.attachment.name;
    download.hidden = false;
  }
  advance.addEventListener('click', () => advanceStatus(request, advance));
  return card;
}

function startEdit(request) {
  editingId = request.id;
  for (const field of ['student', 'document', 'copies', 'mode', 'paperSize']) {
    form.elements.namedItem(field).value = request[field] ?? 'A4';
  }
  form.elements.namedItem('studentId').value = request.studentId ?? '';
  form.elements.namedItem('sides').value = request.sides ?? 'one';
  formTitle.textContent = `Edit ${request.id}`;
  submitButton.textContent = 'Save changes';
  cancelEdit.hidden = false;
  attachment.required = !request.attachment;
  if (request.attachment) {
    attachmentHelp.textContent = `Attached: ${request.attachment.name}. Choose a new file to replace it. ${attachmentHint}`;
  }
  showMessage(formMessage, '');
  form.elements.namedItem('student').focus();
}

function resetForm() {
  editingId = null;
  form.reset();
  formTitle.textContent = 'New request';
  submitButton.textContent = 'Submit request';
  cancelEdit.hidden = true;
  attachment.required = true;
  attachmentHelp.textContent = attachmentHint;
}

function advanceStatus(request, button) {
  const status = nextStatus[request.status];
  button.disabled = true;
  try {
    const currentRequests = loadRequests();
    const current = currentRequests.find(item => item.id === request.id);
    if (current?.status !== request.status) {
      refreshRequests();
      throw new Error('The request has changed. Check its current status.');
    }
    saveRequests(currentRequests.map(item =>
      item.id === request.id ? { ...item, status } : item
    ));
    renderRequests();
    showMessage(listMessage, `${request.id} is now ${status.toLowerCase()}.`);
    // Rendering replaces the button, so focus the current card.
    const card = list.querySelector(`[data-id="${request.id}"]`);
    const nextButton = card?.querySelector('.advance:not([hidden])');
    (nextButton ?? card?.querySelector('.edit') ?? filter).focus();
  } catch (error) {
    showMessage(listMessage, error.message, true);
  } finally {
    button.disabled = false;
  }
}

// Convert the file to base64 so it can be saved in browser storage.
function readAttachment(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      const base64 = reader.result.split(',')[1];
      resolve({ name: file.name, url: `data:application/octet-stream;base64,${base64}` });
    });
    reader.addEventListener('error', reject);
    reader.readAsDataURL(file);
  });
}

async function submitRequest(event) {
  event.preventDefault();
  if (submitButton.disabled) return;
  const fields = new FormData(form);
  const details = {
    student: fields.get('student').trim(),
    studentId: fields.get('studentId').trim(),
    document: fields.get('document').trim(),
    copies: Number(fields.get('copies')),
    mode: fields.get('mode'),
    paperSize: fields.get('paperSize'),
    sides: fields.get('sides')
  };

  if (!details.student || !details.document) {
    showMessage(formMessage, 'Enter both a student name and a document name.', true);
    form.elements.namedItem(details.student ? 'document' : 'student').focus();
    return;
  }

  if (!details.studentId) {
    showMessage(formMessage, 'Enter your student ID or registration number.', true);
    form.elements.namedItem('studentId').focus();
    return;
  }

  const file = attachment.files[0];
  if (!file && attachment.required) {
    showMessage(formMessage, 'Choose a document to attach.', true);
    attachment.focus();
    return;
  }

  if (file && (!/\.(pdf|docx?)$/i.test(file.name) || file.size === 0 || file.size > maxFileSize)) {
    showMessage(formMessage, 'Choose a non-empty PDF or Word file up to 1 MB.', true);
    attachment.focus();
    return;
  }

  submitButton.disabled = true;
  try {
    if (file) details.attachment = await readAttachment(file);
    const currentRequests = loadRequests();
    if (editingId) {
      saveRequests(currentRequests.map(item =>
        item.id === editingId ? { ...item, ...details } : item
      ));
      location.href = `track.html?updated=${editingId}`;
      return;
    }

    const highestNumber = currentRequests.reduce(
      (highest, request) => Math.max(highest, Number(request.id.slice(3))), 0
    );
    const id = `CP-${String(highestNumber + 1).padStart(3, '0')}`;
    saveRequests([{ id, ...details, status: 'Submitted' }, ...currentRequests]);
    resetForm();
    showMessage(formMessage, `${id} submitted. You can track it in the requests list.`);
    viewRequests.hidden = false;
  } catch (error) {
    showMessage(formMessage, error.message || 'Could not read the document.', true);
  } finally {
    submitButton.disabled = false;
  }
}

// Each page runs only the code for the controls it contains.
function startPage() {
  const params = new URLSearchParams(location.search);
  try {
    if (list) {
      search.addEventListener('input', renderRequests);
      filter.addEventListener('change', renderRequests);
      document.querySelector('#refresh-requests').addEventListener('click', () => {
        try {
          refreshRequests();
          showMessage(listMessage, 'Requests refreshed.');
        } catch (error) {
          showMessage(listMessage, error.message, true);
        }
      });
    }
    if (dashboardMessage || list) refreshRequests();
    if (list && requests.some(request => request.id === params.get('updated'))) {
      showMessage(listMessage, `${params.get('updated')} updated.`);
      history.replaceState(null, '', 'track.html');
    }
    if (form) {
      const editId = params.get('edit');
      if (editId) {
        requests = loadRequests();
        const request = requests.find(item => item.id === editId);
        if (!request) throw new Error('That request could not be found.');
        startEdit(request);
      }
      form.addEventListener('submit', submitRequest);
      submitButton.disabled = false;
    }
  } catch (error) {
    showMessage(listMessage ?? formMessage ?? dashboardMessage, error.message, true);
  }
}

function refreshIfVisible() {
  if (!dashboardMessage && !list) return;
  try {
    refreshRequests();
  } catch (error) {
    showMessage(listMessage ?? dashboardMessage, error.message, true);
  }
}

// Refresh when returning to a cached page or when another tab saves a request.
window.addEventListener('pageshow', event => {
  if (event.persisted) refreshIfVisible();
});
window.addEventListener('storage', event => {
  if (event.key === storageKey) refreshIfVisible();
});

startPage();
