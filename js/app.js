/**
 * Sistema de Agendamento - JavaScript principal.
 */

const API_URL = window.API_URL || 'http://localhost:8000';
const SERVER_WAKEUP_TIMEOUT = 90000;
const AUTH_SESSION_KEY = 'auth_session';
const REMEMBER_ME_DURATION_MS = 24 * 60 * 60 * 1000;

let currentUser = null;
let selectedComprador = null;
let selectedDate = null;
let selectedTime = null;
let horariosDisponiveis = [];
let currentVisitPhoneSearch = '';

function clearLegacyAuthKeys() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('user');
}

function clearAuthSession() {
    localStorage.removeItem(AUTH_SESSION_KEY);
    sessionStorage.removeItem(AUTH_SESSION_KEY);
    clearLegacyAuthKeys();
}

function migrateLegacyAuthSession() {
    const legacyLocalToken = localStorage.getItem('token');
    const legacyLocalUser = localStorage.getItem('user');
    if (legacyLocalToken && legacyLocalUser) {
        try {
            localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({
                token: legacyLocalToken,
                user: JSON.parse(legacyLocalUser),
                rememberMe: true,
                expiresAt: Date.now() + REMEMBER_ME_DURATION_MS
            }));
        } catch (error) {
            localStorage.removeItem(AUTH_SESSION_KEY);
        }
    }

    const legacySessionToken = sessionStorage.getItem('token');
    const legacySessionUser = sessionStorage.getItem('user');
    if (legacySessionToken && legacySessionUser) {
        try {
            sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({
                token: legacySessionToken,
                user: JSON.parse(legacySessionUser),
                rememberMe: false,
                expiresAt: null
            }));
        } catch (error) {
            sessionStorage.removeItem(AUTH_SESSION_KEY);
        }
    }

    clearLegacyAuthKeys();
}

function getStoredAuthSession() {
    migrateLegacyAuthSession();

    const localSessionRaw = localStorage.getItem(AUTH_SESSION_KEY);
    if (localSessionRaw) {
        try {
            const localSession = JSON.parse(localSessionRaw);
            if (localSession?.expiresAt && Date.now() > localSession.expiresAt) {
                clearAuthSession();
                return null;
            }
            if (localSession?.token && localSession?.user) {
                return { storage: localStorage, session: localSession };
            }
        } catch (error) {
            clearAuthSession();
            return null;
        }
    }

    const sessionRaw = sessionStorage.getItem(AUTH_SESSION_KEY);
    if (!sessionRaw) {
        return null;
    }

    try {
        const session = JSON.parse(sessionRaw);
        if (session?.token && session?.user) {
            return { storage: sessionStorage, session };
        }
    } catch (error) {
        clearAuthSession();
        return null;
    }

    return null;
}

function getAuthStorage() {
    return getStoredAuthSession()?.storage || localStorage;
}

function getAuthToken() {
    return getStoredAuthSession()?.session?.token || null;
}

function saveAuthSession(token, user, rememberMe) {
    clearAuthSession();

    const session = {
        token,
        user,
        rememberMe,
        expiresAt: rememberMe ? (Date.now() + REMEMBER_ME_DURATION_MS) : null
    };

    const storage = rememberMe ? localStorage : sessionStorage;
    storage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
}

function showLoading(message = 'Carregando...', subtext = '') {
    const overlay = document.getElementById('loadingOverlay');
    if (!overlay) return;

    const textEl = overlay.querySelector('.loading-text');
    const subtextEl = overlay.querySelector('.loading-subtext');

    if (textEl) textEl.textContent = message;
    if (subtextEl) subtextEl.textContent = subtext;

    overlay.classList.add('active');
}

function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        overlay.classList.remove('active');
    }
}

async function apiRequest(endpoint, options = {}) {
    const url = `${API_URL}${endpoint}`;
    const token = getAuthToken();
    const isFormData = options.body instanceof FormData;
    let loadingTimeout = null;

    const defaultHeaders = {};
    if (!isFormData) {
        defaultHeaders['Content-Type'] = 'application/json';
    }
    if (token) {
        defaultHeaders['Authorization'] = `Bearer ${token}`;
    }

    const finalOptions = {
        ...options,
        headers: {
            ...defaultHeaders,
            ...(options.headers || {})
        }
    };

    try {
        loadingTimeout = setTimeout(() => {
            showLoading('Carregando dados...');
        }, 700);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), SERVER_WAKEUP_TIMEOUT);
        const response = await fetch(url, { ...finalOptions, signal: controller.signal });
        clearTimeout(timeout);
        clearTimeout(loadingTimeout);

        if (!response.ok) {
            if (response.status === 401) {
                clearAuthSession();
                if (document.body?.dataset?.page && !['login', 'esqueci-senha', 'agendamento', 'minhas-visitas'].includes(document.body.dataset.page)) {
                    redirectToLogin();
                }
            }
            const error = await response.json().catch(() => ({ detail: 'Erro desconhecido' }));
            throw new Error(error.detail || 'Erro na requisicao');
        }

        hideLoading();
        if (response.status === 204) {
            return null;
        }

        return await response.json();
    } catch (error) {
        clearTimeout(loadingTimeout);
        hideLoading();

        if (error.name === 'TypeError' || error.name === 'AbortError') {
            showAlert('error', 'Servidor indisponivel', 'Nao foi possivel conectar ao servidor. Tente novamente em alguns instantes.');
        } else {
            showAlert('error', 'Erro', error.message);
        }

        throw error;
    }
}

async function checkServerStatus() {
    try {
        await fetch(`${API_URL}/health`);
        return true;
    } catch (error) {
        return false;
    }
}

function showAlert(type, title, message) {
    const container = document.getElementById('alertContainer');
    if (!container) return;

    const icons = {
        success: 'OK',
        error: 'X',
        warning: '!',
        info: 'i'
    };

    const alert = document.createElement('div');
    alert.className = `alert alert-${type} fade-in`;
    alert.innerHTML = `
        <span class="alert-icon">${icons[type]}</span>
        <div class="alert-content">
            <div class="alert-title">${title}</div>
            <div>${message}</div>
        </div>
    `;

    container.appendChild(alert);

    setTimeout(() => {
        alert.style.opacity = '0';
        setTimeout(() => alert.remove(), 300);
    }, 5000);
}

function formatDate(date) {
    return new Date(date).toLocaleDateString('pt-BR', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

function formatTime(date) {
    return new Date(date).toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatDateInput(date) {
    return date.toISOString().split('T')[0];
}

function formatMonthInput(date) {
    return date.toISOString().slice(0, 7);
}

function getMinDate() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
}

function isLoggedIn() {
    const auth = getStoredAuthSession();
    return !!auth?.session?.token && !!auth?.session?.user;
}

function getCurrentUser() {
    return getStoredAuthSession()?.session?.user || null;
}

function setCurrentUser(user) {
    currentUser = user;
    const auth = getStoredAuthSession();
    if (!auth) return;

    auth.session.user = user;
    auth.storage.setItem(AUTH_SESSION_KEY, JSON.stringify(auth.session));
}

function hasRole(roles = []) {
    const user = getCurrentUser();
    return !!user && roles.includes(user.tipo);
}

function getHomePageForUser(user) {
    if (!user) {
        return 'login.html';
    }
    return user.tipo === 'comprador' ? 'dashboard.html' : 'dashboard-dados.html';
}

function redirectToLogin() {
    if (!['login', 'esqueci-senha'].includes(document.body?.dataset?.page || '')) {
        window.location.href = 'login.html';
    }
}

function enforcePageAccess(page) {
    const publicPages = new Set(['home', 'login', 'esqueci-senha', 'agendamento', 'minhas-visitas']);
    if (!page || publicPages.has(page)) {
        if (page === 'login' && isLoggedIn()) {
            window.location.href = getHomePageForUser(getCurrentUser());
            return false;
        }
        return true;
    }

    if (!isLoggedIn()) {
        redirectToLogin();
        return false;
    }

    const user = getCurrentUser();
    if (!user) {
        redirectToLogin();
        return false;
    }

    const roleRules = {
        dashboard: ['comprador'],
        disponibilidade: ['comprador'],
        'dashboard-dados': ['administrador', 'desenvolvedor'],
        usuarios: ['administrador', 'desenvolvedor'],
        perfil: ['comprador', 'administrador', 'desenvolvedor']
    };

    const allowedRoles = roleRules[page];
    if (allowedRoles && !allowedRoles.includes(user.tipo)) {
        window.location.href = getHomePageForUser(user);
        return false;
    }

    return true;
}

function updateCurrentUserUI() {
    const user = getCurrentUser();
    if (!user) return;

    const initials = (user.nome || 'U')
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0])
        .join('')
        .toUpperCase();

    const userNameEl = document.getElementById('userName');
    const userRoleEl = document.getElementById('userRole');
    const userAvatarEl = document.getElementById('userAvatar');
    const userAvatarFallbackEl = document.getElementById('userAvatarFallback');
    const dropdownUserNameEl = document.getElementById('dropdownUserName');
    const dropdownUserRoleEl = document.getElementById('dropdownUserRole');
    const dropdownUserAvatarEl = document.getElementById('dropdownUserAvatar');
    const dropdownUserAvatarFallbackEl = document.getElementById('dropdownUserAvatarFallback');
    const profilePreviewEl = document.getElementById('profilePreview');
    const profilePlaceholderEl = document.getElementById('profilePlaceholder');

    if (userNameEl) userNameEl.textContent = user.nome;
    if (userRoleEl) userRoleEl.textContent = user.tipo;
    if (dropdownUserNameEl) dropdownUserNameEl.textContent = user.nome;
    if (dropdownUserRoleEl) dropdownUserRoleEl.textContent = user.tipo;
    if (userAvatarEl) {
        userAvatarEl.src = user.foto_url || '';
        userAvatarEl.style.display = user.foto_url ? 'block' : 'none';
    }
    if (userAvatarFallbackEl) userAvatarFallbackEl.textContent = initials;
    if (dropdownUserAvatarEl) {
        dropdownUserAvatarEl.src = user.foto_url || '';
        dropdownUserAvatarEl.style.display = user.foto_url ? 'block' : 'none';
    }
    if (dropdownUserAvatarFallbackEl) dropdownUserAvatarFallbackEl.textContent = initials;
    if (profilePreviewEl) {
        profilePreviewEl.src = user.foto_url || '';
        profilePreviewEl.style.display = user.foto_url ? 'block' : 'none';
    }
    if (profilePlaceholderEl) {
        profilePlaceholderEl.style.display = user.foto_url ? 'none' : 'block';
    }
}

function formatPhone(value) {
    const digits = (value || '').replace(/\D/g, '').slice(0, 11);
    if (digits.length <= 2) return digits ? `(${digits}` : '';
    if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function normalizePhoneDigits(value) {
    return (value || '').replace(/\D/g, '');
}

function resolveWhatsAppMessage(agendamento) {
    const user = getCurrentUser();
    const template = user?.mensagem_whatsapp
        || 'Ola, {nome_vendedor}. Aqui e {nome_comprador}. Estou entrando em contato pelo Sistema de Agendamento sobre a visita de {data} as {hora}.';

    const variables = {
        '{nome_vendedor}': agendamento.nome_vendedor || 'vendedor',
        '{nome_comprador}': user?.nome || 'comprador',
        '{empresa}': agendamento.empresa_vendedor || 'Nao informada',
        '{data}': new Date(agendamento.data_hora).toLocaleDateString('pt-BR'),
        '{hora}': formatTime(agendamento.data_hora),
        '{status}': agendamento.status || 'pendente'
    };

    return Object.entries(variables).reduce(
        (message, [placeholder, value]) => message.split(placeholder).join(value),
        template
    );
}

function buildWhatsAppLink(telefone, agendamento) {
    const digits = normalizePhoneDigits(telefone);
    if (!digits) return '';

    let phone = digits;
    if (phone.length === 10 || phone.length === 11) {
        phone = `55${phone}`;
    }

    const message = encodeURIComponent(resolveWhatsAppMessage(agendamento));
    return `https://wa.me/${phone}?text=${message}`;
}

function renderContatoRapido(agendamento) {
    const actions = [];

    if (agendamento.email_vendedor) {
        const subject = encodeURIComponent('Contato pelo Sistema de Agendamento');
        actions.push(`
            <a class="btn btn-outline btn-sm" href="mailto:${agendamento.email_vendedor}?subject=${subject}">
                Enviar email
            </a>
        `);
    }

    const whatsappLink = buildWhatsAppLink(agendamento.telefone_vendedor, agendamento);
    if (whatsappLink) {
        actions.push(`
            <a class="btn btn-secondary btn-sm" href="${whatsappLink}" target="_blank" rel="noopener noreferrer">
                WhatsApp
            </a>
        `);
    }

    if (!actions.length) {
        return '';
    }

    return `<div class="contact-actions">${actions.join('')}</div>`;
}

function syncProfileNav() {
    const user = getCurrentUser();
    if (!user) return;

    const dashboardLink = document.getElementById('linkDashboard');
    const dashboardDadosLink = document.getElementById('linkDashboardDados');
    const disponibilidadeLink = document.getElementById('linkDisponibilidade');
    const usuariosLink = document.getElementById('linkUsuarios');

    if (dashboardLink) {
        dashboardLink.style.display = user.tipo === 'comprador' ? 'inline-flex' : 'none';
    }
    if (dashboardDadosLink) {
        dashboardDadosLink.style.display = ['administrador', 'desenvolvedor'].includes(user.tipo) ? 'inline-flex' : 'none';
    }
    if (disponibilidadeLink) {
        disponibilidadeLink.style.display = user.tipo === 'comprador' ? 'inline-flex' : 'none';
    }
    if (usuariosLink) {
        usuariosLink.style.display = user.tipo === 'comprador' ? 'none' : 'inline-flex';
    }
}

function initProfileMenu() {
    const button = document.getElementById('profileMenuButton');
    const dropdown = document.getElementById('profileDropdown');
    if (!button || !dropdown || button.dataset.bound === 'true') return;

    const closeMenu = () => {
        dropdown.classList.remove('open');
        button.classList.remove('active');
        button.setAttribute('aria-expanded', 'false');
    };

    button.addEventListener('click', (event) => {
        event.stopPropagation();
        const willOpen = !dropdown.classList.contains('open');
        closeMenu();
        if (willOpen) {
            dropdown.classList.add('open');
            button.classList.add('active');
            button.setAttribute('aria-expanded', 'true');
        }
    });

    dropdown.addEventListener('click', (event) => {
        event.stopPropagation();
    });

    document.addEventListener('click', closeMenu);
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeMenu();
        }
    });

    button.dataset.bound = 'true';
}

async function login(email, password, rememberMe = false) {
    try {
        const formData = new FormData();
        formData.append('username', email);
        formData.append('password', password);
        formData.append('remember_me', rememberMe ? 'true' : 'false');

        const response = await apiRequest('/auth/login', {
            method: 'POST',
            body: formData
        });

        saveAuthSession(response.access_token, response.usuario, rememberMe);
        currentUser = response.usuario;

        showAlert('success', 'Login realizado', `Bem-vindo(a), ${response.usuario.nome}`);

        const destination = response.usuario.tipo === 'comprador'
            ? 'dashboard.html'
            : 'dashboard-dados.html';

        setTimeout(() => {
            window.location.href = destination;
        }, 800);

        return true;
    } catch (error) {
        return false;
    }
}

async function requestPasswordReset(email) {
    try {
        return await apiRequest('/auth/esqueci-senha', {
            method: 'POST',
            body: JSON.stringify({ email })
        });
    } catch (error) {
        return null;
    }
}

async function confirmPasswordReset(email, codigo, novaSenha) {
    try {
        return await apiRequest('/auth/redefinir-senha', {
            method: 'POST',
            body: JSON.stringify({
                email,
                codigo,
                nova_senha: novaSenha
            })
        });
    } catch (error) {
        return null;
    }
}

function logout() {
    clearAuthSession();
    currentUser = null;
    window.location.href = 'index.html';
}

async function loadCompradores() {
    try {
        const compradores = await apiRequest('/compradores?ativo=true');
        renderCompradores(compradores);
        return compradores;
    } catch (error) {
        console.error('Erro ao carregar compradores:', error);
        return [];
    }
}

function renderCompradores(compradores) {
    const container = document.getElementById('compradoresGrid');
    if (!container) return;

    if (!compradores.length) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">CP</div>
                <div class="empty-title">Nenhum comprador disponivel</div>
                <div class="empty-description">Nao ha compradores cadastrados no momento.</div>
            </div>
        `;
        return;
    }

    container.innerHTML = compradores.map((comprador) => `
        <div class="comprador-card" onclick="selectComprador(${comprador.id}, '${comprador.nome}', '${comprador.email}')" id="comprador-${comprador.id}">
            <div class="comprador-avatar">
                ${comprador.foto_url ? `<img src="${comprador.foto_url}" alt="${comprador.nome}">` : `<span>${comprador.nome.charAt(0).toUpperCase()}</span>`}
            </div>
            <div class="comprador-name">${comprador.nome}</div>
            <div class="comprador-email">${comprador.email}</div>
        </div>
    `).join('');
}

function selectComprador(id, nome, email) {
    document.querySelectorAll('.comprador-card').forEach((card) => {
        card.classList.remove('selected');
    });

    const card = document.getElementById(`comprador-${id}`);
    if (card) card.classList.add('selected');

    selectedComprador = { id, nome, email };

    const selectedCompradorNomeEl = document.getElementById('selectedCompradorNome');
    if (selectedCompradorNomeEl) {
        selectedCompradorNomeEl.textContent = nome;
    }

    showStep(2);
    loadDisponibilidade();
}

async function loadDisponibilidade() {
    if (!selectedComprador || !selectedDate) return;

    try {
        showLoading('Carregando horarios disponiveis...');
        const dataStr = formatDateInput(selectedDate);
        const response = await apiRequest(`/disponibilidade/${selectedComprador.id}?data=${dataStr}`);
        horariosDisponiveis = response.horarios;
        renderHorarios();
        hideLoading();
    } catch (error) {
        console.error('Erro ao carregar disponibilidade:', error);
        hideLoading();
    }
}

function renderHorarios() {
    const container = document.getElementById('horariosGrid');
    if (!container) return;

    if (!horariosDisponiveis.length) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-title">Nenhum horario disponivel</div>
                <div class="empty-description">Selecione outra data para ver horarios disponiveis.</div>
            </div>
        `;
        return;
    }

    container.innerHTML = horariosDisponiveis.map((horario) => `
        <button class="horario-btn ${horario.disponivel ? '' : 'disabled'}"
                onclick="selectTime('${horario.data_hora}')"
                ${horario.disponivel ? '' : 'disabled'}
                id="horario-${new Date(horario.data_hora).getTime()}">
            <span class="hora">${formatTime(horario.data_hora)}</span>
        </button>
    `).join('');
}

function selectTime(dateTime) {
    document.querySelectorAll('.horario-btn').forEach((btn) => {
        btn.classList.remove('selected');
    });

    const btn = document.getElementById(`horario-${new Date(dateTime).getTime()}`);
    if (btn) btn.classList.add('selected');

    selectedTime = dateTime;
    showStep(3);
}

function initDatePicker() {
    selectedDate = new Date();
    selectedDate.setHours(0, 0, 0, 0);

    while (selectedDate.getDay() === 0 || selectedDate.getDay() === 6) {
        selectedDate.setDate(selectedDate.getDate() + 1);
    }

    updateDateDisplay();

    const dateInput = document.getElementById('dateInput');
    if (dateInput) {
        dateInput.min = formatDateInput(new Date());
        dateInput.value = formatDateInput(selectedDate);
    }
}

function prevDay() {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() - 1);

    const today = getMinDate();
    if (newDate >= today && newDate.getDay() !== 0 && newDate.getDay() !== 6) {
        selectedDate = newDate;
        updateDateDisplay();
        loadDisponibilidade();
    }
}

function nextDay() {
    const newDate = new Date(selectedDate);

    do {
        newDate.setDate(newDate.getDate() + 1);
    } while (newDate.getDay() === 0 || newDate.getDay() === 6);

    selectedDate = newDate;
    updateDateDisplay();
    loadDisponibilidade();
}

function updateDateDisplay() {
    const display = document.getElementById('dateDisplay');
    const dateInput = document.getElementById('dateInput');

    if (display) {
        display.textContent = formatDate(selectedDate);
    }

    if (dateInput) {
        dateInput.value = formatDateInput(selectedDate);
    }
}

function handleDateChange(event) {
    const newDate = new Date(`${event.target.value}T12:00:00`);

    if (newDate.getDay() === 0 || newDate.getDay() === 6) {
        showAlert('warning', 'Data invalida', 'Por favor, selecione um dia util.');
        return;
    }

    if (newDate < getMinDate()) {
        showAlert('warning', 'Data invalida', 'Nao e possivel agendar em datas passadas.');
        return;
    }

    selectedDate = newDate;
    updateDateDisplay();
    loadDisponibilidade();
}

async function criarAgendamento(dados) {
    try {
        const response = await apiRequest('/agendamentos', {
            method: 'POST',
            body: JSON.stringify(dados)
        });

        showAlert('success', 'Agendamento realizado', 'Seu agendamento foi criado com sucesso.');
        resetForm();
        return response;
    } catch (error) {
        return null;
    }
}

async function loadAgendamentos(filters = {}) {
    try {
        let url = '/agendamentos';
        const params = new URLSearchParams();

        if (filters.status) params.append('status', filters.status);
        if (filters.dataInicio) params.append('data_inicio', filters.dataInicio);
        if (filters.dataFim) params.append('data_fim', filters.dataFim);

        if (params.toString()) {
            url += `?${params.toString()}`;
        }

        return await apiRequest(url);
    } catch (error) {
        console.error('Erro ao carregar agendamentos:', error);
        return [];
    }
}

async function atualizarAgendamento(id, dados) {
    try {
        return await apiRequest(`/agendamentos/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(dados)
        });
    } catch (error) {
        return null;
    }
}

async function loadUsuarios() {
    try {
        return await apiRequest('/usuarios');
    } catch (error) {
        console.error('Erro ao carregar usuarios:', error);
        return [];
    }
}

async function loadGestaoAgendamentos() {
    try {
        return await apiRequest('/gestao/agendamentos');
    } catch (error) {
        console.error('Erro ao carregar agendamentos gerenciais:', error);
        return [];
    }
}

async function loadMeuPerfil() {
    try {
        const user = await apiRequest('/auth/me');
        setCurrentUser(user);
        updateCurrentUserUI();
        return user;
    } catch (error) {
        return null;
    }
}

async function atualizarMeuPerfil(dados) {
    try {
        const user = await apiRequest('/usuarios/me', {
            method: 'PATCH',
            body: JSON.stringify(dados)
        });
        setCurrentUser(user);
        updateCurrentUserUI();
        return user;
    } catch (error) {
        return null;
    }
}

async function criarUsuarioSistema(dados) {
    try {
        return await apiRequest('/usuarios', {
            method: 'POST',
            body: JSON.stringify(dados)
        });
    } catch (error) {
        return null;
    }
}

async function loadMinhasVisitas(telefone) {
    try {
        const telefoneFormatado = formatPhone(telefone);
        return await apiRequest(`/minhas-visitas?telefone=${encodeURIComponent(telefoneFormatado)}`);
    } catch (error) {
        return [];
    }
}

async function desistirMinhaVisita(id, telefone, motivo) {
    try {
        return await apiRequest(`/minhas-visitas/${id}/desistir`, {
            method: 'POST',
            body: JSON.stringify({ telefone, motivo })
        });
    } catch (error) {
        return null;
    }
}

async function loadMinhasDisponibilidades(month) {
    try {
        const params = new URLSearchParams();
        if (month) {
            params.append('mes', month);
        }

        const query = params.toString() ? `?${params.toString()}` : '';
        return await apiRequest(`/minhas-disponibilidades${query}`);
    } catch (error) {
        console.error('Erro ao carregar disponibilidades:', error);
        return [];
    }
}

function getStartOfWeek(dateValue) {
    const date = new Date(dateValue);
    const day = date.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    date.setDate(date.getDate() + diff);
    date.setHours(0, 0, 0, 0);
    return date;
}

function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate();
}

function collectCompanies(agendamentos) {
    const counts = {};
    agendamentos.forEach((item) => {
        const empresa = (item.empresa_vendedor || 'Nao informada').trim();
        counts[empresa] = (counts[empresa] || 0) + 1;
    });

    return Object.entries(counts)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([empresa, total]) => `${empresa} (${total})`)
        .join(', ');
}

function collectRepeatVendors(agendamentos) {
    const vendors = {};

    agendamentos.forEach((item) => {
        const key = `${(item.nome_vendedor || '').trim().toLowerCase()}|${(item.telefone_vendedor || '').trim()}`;
        if (!vendors[key]) {
            vendors[key] = {
                nome: item.nome_vendedor || 'Vendedor nao informado',
                total: 0,
                dias: new Set()
            };
        }
        vendors[key].total += 1;
        vendors[key].dias.add(new Date(item.data_hora).toLocaleDateString('pt-BR'));
    });

    const repeats = Object.values(vendors).filter((item) => item.total > 1);
    if (!repeats.length) {
        return 'Nenhum retorno registrado';
    }

    return repeats
        .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome))
        .map((item) => `${item.nome}: ${item.total} visitas (${Array.from(item.dias).join(', ')})`)
        .join(' | ');
}

function getInitials(name) {
    return (name || 'U')
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part.charAt(0).toUpperCase())
        .join('');
}

function buildStatusBreakdown(agendamentos) {
    const statusOrder = ['pendente', 'confirmado', 'concluido', 'nao_compareceu', 'desistiu', 'cancelado'];
    const counts = {
        pendente: 0,
        confirmado: 0,
        concluido: 0,
        nao_compareceu: 0,
        desistiu: 0,
        cancelado: 0
    };

    agendamentos.forEach((item) => {
        if (counts[item.status] !== undefined) {
            counts[item.status] += 1;
        }
    });

    return statusOrder.map((status) => ({
        status,
        total: counts[status]
    }));
}

function buildCompanyRanking(agendamentos) {
    const counts = {};
    agendamentos.forEach((item) => {
        const empresa = (item.empresa_vendedor || 'Nao informada').trim();
        counts[empresa] = (counts[empresa] || 0) + 1;
    });

    return Object.entries(counts)
        .map(([nome, total]) => ({ nome, total }))
        .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome));
}

function buildRecurringVendorRanking(agendamentos) {
    const counts = {};
    agendamentos.forEach((item) => {
        const key = `${(item.nome_vendedor || '').trim().toLowerCase()}|${(item.telefone_vendedor || '').trim()}`;
        if (!counts[key]) {
            counts[key] = {
                nome: item.nome_vendedor || 'Vendedor nao informado',
                total: 0
            };
        }
        counts[key].total += 1;
    });

    return Object.values(counts)
        .filter((item) => item.total > 1)
        .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome));
}

function buildMetricBars(item) {
    const metrics = [
        { label: 'Hoje', value: item.totalDia },
        { label: 'Semana', value: item.totalSemana },
        { label: 'Mes', value: item.totalMes },
        { label: 'Ano', value: item.totalAno }
    ];
    const maxValue = Math.max(...metrics.map((metric) => metric.value), 1);

    return metrics.map((metric) => ({
        ...metric,
        percent: Math.max((metric.value / maxValue) * 100, metric.value ? 14 : 0)
    }));
}

function buildBuyerPerformance(agendamentos) {
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const weekStart = getStartOfWeek(now);
    const month = now.getMonth();
    const year = now.getFullYear();
    const byBuyer = new Map();

    agendamentos.forEach((item) => {
        const buyerName = item.nome_comprador || 'Comprador nao informado';
        if (!byBuyer.has(buyerName)) {
            byBuyer.set(buyerName, []);
        }
        byBuyer.get(buyerName).push(item);
    });

    return Array.from(byBuyer.entries()).map(([nome, items]) => {
        const visits = items.map((item) => ({ ...item, _date: new Date(item.data_hora) }));
        const totalDia = visits.filter((item) => sameDay(item._date, now)).length;
        const totalSemana = visits.filter((item) => item._date >= weekStart).length;
        const totalMes = visits.filter((item) => item._date.getMonth() === month && item._date.getFullYear() === year).length;
        const totalAno = visits.filter((item) => item._date.getFullYear() === year).length;

        return {
            nome,
            totalDia,
            totalSemana,
            totalMes,
            totalAno,
            empresas: collectCompanies(visits),
            recorrentes: collectRepeatVendors(visits),
            totalGeral: visits.length,
            metricBars: buildMetricBars({
                totalDia,
                totalSemana,
                totalMes,
                totalAno
            })
        };
    }).sort((a, b) => b.totalGeral - a.totalGeral || a.nome.localeCompare(b.nome));
}

function updateManagementSummary(agendamentos) {
    const totalVisitas = document.getElementById('mgTotalVisitas');
    const totalCompradores = document.getElementById('mgTotalCompradores');
    const totalEmpresas = document.getElementById('mgTotalEmpresas');
    const totalRetornos = document.getElementById('mgTotalRetornos');
    const topComprador = document.getElementById('mgTopComprador');
    const topCompradorResumo = document.getElementById('mgTopCompradorResumo');

    const compradores = new Set(agendamentos.map((item) => item.nome_comprador));
    const empresas = new Set(
        agendamentos
            .map((item) => (item.empresa_vendedor || '').trim())
            .filter(Boolean)
    );

    const vendorCounts = {};
    agendamentos.forEach((item) => {
        const key = `${(item.nome_vendedor || '').trim().toLowerCase()}|${(item.telefone_vendedor || '').trim()}`;
        vendorCounts[key] = (vendorCounts[key] || 0) + 1;
    });
    const retornos = Object.values(vendorCounts).filter((count) => count > 1).length;
    const performance = buildBuyerPerformance(agendamentos);
    const topBuyer = performance[0];

    if (totalVisitas) totalVisitas.textContent = String(agendamentos.length);
    if (totalCompradores) totalCompradores.textContent = String(compradores.size);
    if (totalEmpresas) totalEmpresas.textContent = String(empresas.size);
    if (totalRetornos) totalRetornos.textContent = String(retornos);
    if (topComprador) topComprador.textContent = topBuyer ? topBuyer.nome : 'Sem ranking';
    if (topCompradorResumo) {
        topCompradorResumo.textContent = topBuyer
            ? `${topBuyer.totalGeral} visitas acumuladas e ${topBuyer.totalMes} registradas no mes atual.`
            : 'Assim que houver visitas, o ranking aparece aqui.';
    }
}

function renderStatusOverview(agendamentos) {
    const container = document.getElementById('statusOverview');
    if (!container) return;

    const breakdown = buildStatusBreakdown(agendamentos);
    const total = Math.max(agendamentos.length, 1);
    const percentages = breakdown.map((item) => ({
        ...item,
        percent: (item.total / total) * 100
    }));

    const donutStyle = `
        --status-pendente:${percentages[0].percent.toFixed(2)}%;
        --status-confirmado:${percentages[1].percent.toFixed(2)}%;
        --status-concluido:${percentages[2].percent.toFixed(2)}%;
        --status-nao_compareceu:${percentages[3].percent.toFixed(2)}%;
        --status-desistiu:${percentages[4].percent.toFixed(2)}%;
        --status-cancelado:${percentages[5].percent.toFixed(2)}%;
    `;

    container.innerHTML = `
        <div class="insight-card-header">
            <div>
                <div class="insight-card-eyebrow">Distribuicao</div>
                <h3 class="insight-card-title">Status das visitas</h3>
            </div>
        </div>
        <div class="status-donut-layout">
            <div class="status-donut" style="${donutStyle}">
                <div class="status-donut-center">
                    <strong>${agendamentos.length}</strong>
                    <span>visitas</span>
                </div>
            </div>
            <div class="status-legend">
                ${percentages.map((item) => `
                    <div class="status-legend-item">
                        <span class="status-legend-dot status-${item.status}"></span>
                        <div>
                            <strong>${item.total}</strong>
                            <span>${item.status}</span>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

function renderTopCompradoresChart(performance) {
    const container = document.getElementById('buyersRanking');
    if (!container) return;

    const ranking = performance.slice(0, 5);
    const maxTotal = Math.max(...ranking.map((item) => item.totalGeral), 1);

    container.innerHTML = `
        <div class="insight-card-header">
            <div>
                <div class="insight-card-eyebrow">Ranking</div>
                <h3 class="insight-card-title">Compradores com mais visitas</h3>
            </div>
        </div>
        <div class="ranking-list">
            ${ranking.map((item, index) => `
                <div class="ranking-item">
                    <div class="ranking-item-top">
                        <div class="ranking-avatar">${getInitials(item.nome)}</div>
                        <div class="ranking-copy">
                            <strong>${item.nome}</strong>
                            <span>${item.totalGeral} visitas</span>
                        </div>
                        <div class="ranking-position">#${index + 1}</div>
                    </div>
                    <div class="ranking-bar-track">
                        <div class="ranking-bar-fill" style="width:${(item.totalGeral / maxTotal) * 100}%"></div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

function renderCompanyOverview(agendamentos) {
    const container = document.getElementById('companyOverview');
    if (!container) return;

    const companies = buildCompanyRanking(agendamentos).slice(0, 5);
    const recurring = buildRecurringVendorRanking(agendamentos).slice(0, 3);

    container.innerHTML = `
        <div class="insight-card-header">
            <div>
                <div class="insight-card-eyebrow">Infografico</div>
                <h3 class="insight-card-title">Empresas e recorrencia</h3>
            </div>
        </div>
        <div class="insight-subsection">
            <div class="insight-subtitle">Empresas mais presentes</div>
            <div class="company-pill-grid">
                ${companies.length ? companies.map((item) => `
                    <div class="company-pill">
                        <strong>${item.nome}</strong>
                        <span>${item.total} visitas</span>
                    </div>
                `).join('') : '<p class="text-muted">Nenhuma empresa registrada.</p>'}
            </div>
        </div>
        <div class="insight-subsection">
            <div class="insight-subtitle">Vendedores com retorno</div>
            <div class="recurring-list">
                ${recurring.length ? recurring.map((item) => `
                    <div class="recurring-item">
                        <strong>${item.nome}</strong>
                        <span>${item.total} visitas registradas</span>
                    </div>
                `).join('') : '<p class="text-muted">Nenhum vendedor recorrente ate agora.</p>'}
            </div>
        </div>
    `;
}

async function renderDashboardDados() {
    const container = document.getElementById('dashboardDadosList');
    const statusContainer = document.getElementById('statusOverview');
    const rankingContainer = document.getElementById('buyersRanking');
    const companyContainer = document.getElementById('companyOverview');
    if (!container) return;

    const agendamentos = await loadGestaoAgendamentos();
    updateManagementSummary(agendamentos);

    if (!agendamentos.length) {
        const emptyInsight = `
            <div class="empty-state">
                <div class="empty-icon">DT</div>
                <div class="empty-title">Sem dados suficientes</div>
                <div class="empty-description">As visualizacoes aparecerao assim que houver visitas registradas.</div>
            </div>
        `;
        if (statusContainer) statusContainer.innerHTML = emptyInsight;
        if (rankingContainer) rankingContainer.innerHTML = emptyInsight;
        if (companyContainer) companyContainer.innerHTML = emptyInsight;
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">DT</div>
                <div class="empty-title">Nenhum dado gerencial encontrado</div>
                <div class="empty-description">Ainda nao existem visitas registradas para gerar desempenho.</div>
            </div>
        `;
        return;
    }

    const performance = buildBuyerPerformance(agendamentos);
    renderStatusOverview(agendamentos);
    renderTopCompradoresChart(performance);
    renderCompanyOverview(agendamentos);

    container.innerHTML = performance.map((item) => `
        <article class="management-card fade-in">
            <div class="management-card-header">
                <div class="management-card-identity">
                    <div class="management-card-avatar">${getInitials(item.nome)}</div>
                    <div>
                        <h3 class="management-card-title">${item.nome}</h3>
                        <p class="management-card-subtitle">Total geral de visitas: ${item.totalGeral}</p>
                    </div>
                </div>
                <div class="management-card-total">
                    <strong>${item.totalGeral}</strong>
                    <span>visitas</span>
                </div>
            </div>
            <div class="management-metrics">
                <div class="management-metric">
                    <span class="management-metric-value">${item.totalDia}</span>
                    <span class="management-metric-label">Hoje</span>
                </div>
                <div class="management-metric">
                    <span class="management-metric-value">${item.totalSemana}</span>
                    <span class="management-metric-label">Semana</span>
                </div>
                <div class="management-metric">
                    <span class="management-metric-value">${item.totalMes}</span>
                    <span class="management-metric-label">Mes</span>
                </div>
                <div class="management-metric">
                    <span class="management-metric-value">${item.totalAno}</span>
                    <span class="management-metric-label">Ano</span>
                </div>
            </div>
            <div class="management-trend-list">
                ${item.metricBars.map((metric) => `
                    <div class="management-trend-item">
                        <div class="management-trend-head">
                            <span>${metric.label}</span>
                            <strong>${metric.value}</strong>
                        </div>
                        <div class="management-trend-bar">
                            <div class="management-trend-fill" style="width:${metric.percent}%"></div>
                        </div>
                    </div>
                `).join('')}
            </div>
            <div class="management-details-grid">
                <div class="management-detail-box">
                    <span class="management-detail-label">Empresas atendidas</span>
                    <p>${item.empresas || 'Nenhuma empresa registrada'}</p>
                </div>
                <div class="management-detail-box">
                    <span class="management-detail-label">Vendedores recorrentes</span>
                    <p>${item.recorrentes}</p>
                </div>
            </div>
        </article>
    `).join('');
}

async function criarMinhaDisponibilidade(dados) {
    try {
        return await apiRequest('/minhas-disponibilidades', {
            method: 'POST',
            body: JSON.stringify(dados)
        });
    } catch (error) {
        return null;
    }
}

async function removerMinhaDisponibilidade(id) {
    try {
        await apiRequest(`/minhas-disponibilidades/${id}`, {
            method: 'DELETE'
        });
        return true;
    } catch (error) {
        return false;
    }
}

async function renderAgendamentos() {
    const container = document.getElementById('agendamentosList');
    if (!container) return;

    const activeTab = document.querySelector('.tab-btn.active')?.dataset?.status || 'todos';
    const filters = {};
    if (activeTab !== 'todos') {
        filters.status = activeTab;
    }

    const agendamentos = await loadAgendamentos(filters);

    if (!agendamentos.length) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">AG</div>
                <div class="empty-title">Nenhum agendamento</div>
                <div class="empty-description">Voce nao tem agendamentos neste filtro.</div>
            </div>
        `;
        updateStats([]);
        return;
    }

    updateStats(agendamentos);

    container.innerHTML = agendamentos.map((agendamento) => `
        <div class="card mb-3 fade-in">
            <div class="card-body">
                <div style="display:flex; justify-content:space-between; align-items:start; flex-wrap:wrap; gap:16px;">
                    <div>
                        <h3 style="font-size:16px; font-weight:600; margin-bottom:8px;">
                            ${agendamento.nome_vendedor}
                            <span class="badge badge-${agendamento.status}">${agendamento.status}</span>
                        </h3>
                        <p class="text-muted mb-2"><strong>Empresa:</strong> ${agendamento.empresa_vendedor || 'Nao informada'}</p>
                        <p class="text-muted mb-2"><strong>Email:</strong> ${agendamento.email_vendedor}</p>
                        <p class="text-muted mb-2"><strong>Telefone:</strong> ${agendamento.telefone_vendedor || 'Nao informado'}</p>
                        <p class="text-muted"><strong>Data/Hora:</strong> ${formatDate(agendamento.data_hora)} as ${formatTime(agendamento.data_hora)}</p>
                        ${agendamento.observacoes ? `<p class="text-muted mt-2"><strong>Obs:</strong> ${agendamento.observacoes}</p>` : ''}
                        ${agendamento.motivo_vendedor ? `<p class="text-muted mt-2"><strong>Motivo informado pelo vendedor:</strong> ${agendamento.motivo_vendedor}</p>` : ''}
                        ${agendamento.comentario_comprador ? `<p class="text-muted mt-2"><strong>Seu comentario:</strong> ${agendamento.comentario_comprador}</p>` : ''}
                        ${renderContatoRapido(agendamento)}
                    </div>
                    <div class="agendamento-actions">
                        ${renderAgendamentoActions(agendamento)}
                    </div>
                </div>
            </div>
        </div>
    `).join('');
}

function renderAgendamentoActions(agendamento) {
    const actions = [];

    switch (agendamento.status) {
        case 'pendente':
            actions.push(`
                <button class="btn btn-success btn-sm" onclick="confirmarAgendamento(${agendamento.id})">Confirmar</button>
                <button class="btn btn-danger btn-sm mt-2" onclick="cancelarAgendamento(${agendamento.id})">Cancelar</button>
            `);
            break;
        case 'confirmado':
            actions.push(`
                <button class="btn btn-success btn-sm" onclick="concluirAgendamento(${agendamento.id})">Marcar concluido</button>
                <button class="btn btn-danger btn-sm mt-2" onclick="cancelarAgendamento(${agendamento.id})">Cancelar</button>
                <button class="btn btn-warning btn-sm mt-2" onclick="marcarNaoCompareceu(${agendamento.id})">Vendedor nao compareceu</button>
                <button class="btn btn-secondary btn-sm mt-2" onclick="comentarAgendamento(${agendamento.id})">Comentar atendimento</button>
            `);
            break;
        case 'concluido':
            actions.push(`
                <button class="btn btn-secondary btn-sm" onclick="comentarAgendamento(${agendamento.id})">${agendamento.comentario_comprador ? 'Editar comentario' : 'Comentar atendimento'}</button>
            `);
            break;
        default:
            break;
    }

    return actions.join('');
}

async function confirmarAgendamento(id) {
    const result = await atualizarAgendamento(id, { status: 'confirmado' });
    if (result) {
        showAlert('success', 'Agendamento confirmado', 'O agendamento foi confirmado.');
        renderAgendamentos();
    }
}

async function concluirAgendamento(id) {
    const result = await atualizarAgendamento(id, { status: 'concluido' });
    if (result) {
        showAlert('success', 'Visita concluida', 'O agendamento foi marcado como concluido.');
        renderAgendamentos();
    }
}

async function cancelarAgendamento(id) {
    if (!confirm('Tem certeza que deseja cancelar este agendamento?')) {
        return;
    }

    const result = await atualizarAgendamento(id, { status: 'cancelado' });
    if (result) {
        showAlert('warning', 'Agendamento cancelado', 'O agendamento foi cancelado.');
        renderAgendamentos();
    }
}

async function marcarNaoCompareceu(id) {
    if (!confirm('Confirmar que o vendedor nao compareceu no horario marcado?')) {
        return;
    }

    const result = await atualizarAgendamento(id, { status: 'nao_compareceu' });
    if (result) {
        showAlert('warning', 'Ausencia registrada', 'A visita foi marcada como vendedor nao compareceu.');
        renderAgendamentos();
    }
}

async function comentarAgendamento(id) {
    const agendamentos = await loadAgendamentos();
    const agendamento = agendamentos.find((item) => item.id === id);
    const comentarioAtual = agendamento?.comentario_comprador || '';
    const comentario = window.prompt('Digite seu comentario sobre o atendimento:', comentarioAtual);
    if (comentario === null) {
        return;
    }

    const result = await atualizarAgendamento(id, { comentario_comprador: comentario });
    if (result) {
        showAlert('success', 'Comentario salvo', 'Seu comentario sobre o atendimento foi salvo.');
        renderAgendamentos();
    }
}

async function updateStats(agendamentos) {
    const allAgendamentos = agendamentos.length ? await loadAgendamentos() : [];

    const stats = {
        pendente: allAgendamentos.filter((item) => item.status === 'pendente').length,
        confirmado: allAgendamentos.filter((item) => item.status === 'confirmado').length,
        concluido: allAgendamentos.filter((item) => item.status === 'concluido').length
    };

    const pendenteEl = document.getElementById('statPendente');
    const confirmadoEl = document.getElementById('statConfirmado');
    const concluidoEl = document.getElementById('statConcluido');

    if (pendenteEl) pendenteEl.textContent = stats.pendente;
    if (confirmadoEl) confirmadoEl.textContent = stats.confirmado;
    if (concluidoEl) concluidoEl.textContent = stats.concluido;
}

async function renderUsuarios() {
    const container = document.getElementById('usuariosList');
    if (!container) return;

    const usuarios = await loadUsuarios();

    if (!usuarios.length) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">US</div>
                <div class="empty-title">Nenhum usuario</div>
                <div class="empty-description">Nao ha usuarios cadastrados para este perfil.</div>
            </div>
        `;
        return;
    }

    container.innerHTML = usuarios.map((usuario) => `
        <div class="card mb-3 fade-in">
            <div class="card-body">
                <h3 style="font-size:16px; font-weight:600; margin-bottom:8px;">${usuario.nome}</h3>
                <p class="text-muted mb-2"><strong>Email:</strong> ${usuario.email}</p>
                <p class="text-muted mb-2"><strong>Perfil:</strong> ${usuario.tipo}</p>
                <p class="text-muted"><strong>Status:</strong> ${usuario.ativo ? 'ativo' : 'inativo'}</p>
            </div>
        </div>
    `).join('');
}

function getNextAvailableSlot() {
    const slot = new Date();
    slot.setSeconds(0, 0);

    if (slot.getMinutes() % 30 !== 0) {
        slot.setMinutes(slot.getMinutes() + (30 - (slot.getMinutes() % 30)));
    } else {
        slot.setMinutes(slot.getMinutes() + 30);
    }

    if (slot.getHours() < 8) {
        slot.setHours(8, 0, 0, 0);
    }

    if (slot.getHours() >= 18) {
        slot.setDate(slot.getDate() + 1);
        slot.setHours(8, 0, 0, 0);
    }

    while (slot.getDay() === 0 || slot.getDay() === 6) {
        slot.setDate(slot.getDate() + 1);
        slot.setHours(8, 0, 0, 0);
    }

    return slot;
}

function formatDateTimeLocal(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
}

async function renderMinhasDisponibilidades() {
    const container = document.getElementById('disponibilidadesList');
    const monthFilter = document.getElementById('mesDisponibilidade');
    const summary = document.getElementById('disponibilidadeResumo');
    if (!container) return;

    const month = monthFilter?.value || '';
    const disponibilidades = await loadMinhasDisponibilidades(month);
    const livres = disponibilidades.filter((item) => item.disponivel).length;
    const ocupados = disponibilidades.filter((item) => item.ocupado).length;

    if (summary) {
        summary.textContent = `${disponibilidades.length} horarios cadastrados, ${livres} livres e ${ocupados} ocupados.`;
    }

    if (!disponibilidades.length) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">HR</div>
                <div class="empty-title">Nenhum horario cadastrado</div>
                <div class="empty-description">Cadastre horarios livres para aparecerem na agenda publica dos vendedores.</div>
            </div>
        `;
        return;
    }

    container.innerHTML = disponibilidades.map((item) => `
        <div class="availability-card fade-in">
            <div class="availability-card-header">
                <div>
                    <div class="availability-date">${formatDate(item.data_hora)}</div>
                    <div class="availability-time">${formatTime(item.data_hora)}</div>
                </div>
                <span class="badge ${item.ocupado ? 'badge-ocupado' : 'badge-disponivel'}">
                    ${item.ocupado ? 'ocupado' : 'livre'}
                </span>
            </div>
            <div class="availability-meta">
                <p><strong>Cadastrado em:</strong> ${formatDate(item.criado_em)} as ${formatTime(item.criado_em)}</p>
                ${item.nome_vendedor ? `<p><strong>Vendedor:</strong> ${item.nome_vendedor}</p>` : ''}
                ${item.status_agendamento ? `<p><strong>Status da visita:</strong> ${item.status_agendamento}</p>` : ''}
            </div>
            <div class="availability-actions">
                <button
                    class="btn ${item.ocupado ? 'btn-secondary' : 'btn-danger'} btn-sm"
                    onclick="handleDeleteDisponibilidade(${item.id}, ${item.ocupado ? 'true' : 'false'})"
                >
                    ${item.ocupado ? 'Horario ocupado' : 'Remover horario'}
                </button>
            </div>
        </div>
    `).join('');
}

async function handleDeleteDisponibilidade(id, ocupado) {
    if (ocupado) {
        showAlert('info', 'Horario ocupado', 'Esse horario ja possui visita pendente ou confirmada e nao pode ser removido.');
        return;
    }

    if (!confirm('Deseja remover este horario livre?')) {
        return;
    }

    const removed = await removerMinhaDisponibilidade(id);
    if (removed) {
        showAlert('success', 'Horario removido', 'O horario foi removido da sua agenda.');
        renderMinhasDisponibilidades();
    }
}

function showStep(stepNumber) {
    document.querySelectorAll('.step-section').forEach((section) => {
        section.classList.add('hidden');
    });

    const step = document.getElementById(`step${stepNumber}`);
    if (step) {
        step.classList.remove('hidden');
    }

    document.querySelectorAll('.step-indicator').forEach((indicator, index) => {
        if (index + 1 <= stepNumber) {
            indicator.classList.add('active');
        } else {
            indicator.classList.remove('active');
        }
    });
}

function resetForm() {
    selectedComprador = null;
    selectedTime = null;

    document.querySelectorAll('.comprador-card').forEach((card) => {
        card.classList.remove('selected');
    });

    document.querySelectorAll('.horario-btn').forEach((btn) => {
        btn.classList.remove('selected');
    });

    const form = document.getElementById('formAgendamento');
    if (form) form.reset();

    showStep(1);
    initDatePicker();
}

function setupTabs() {
    document.querySelectorAll('.tab-btn').forEach((btn) => {
        btn.addEventListener('click', function () {
            document.querySelectorAll('.tab-btn').forEach((item) => item.classList.remove('active'));
            this.classList.add('active');
            renderAgendamentos();
        });
    });
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function initPasswordToggles() {
    document.querySelectorAll('.password-toggle').forEach((button) => {
        if (button.dataset.bound === 'true') return;

        button.addEventListener('click', () => {
            const inputId = button.dataset.target;
            const input = document.getElementById(inputId);
            if (!input) return;

            const isPassword = input.type === 'password';
            input.type = isPassword ? 'text' : 'password';
            button.textContent = isPassword ? 'Ocultar' : 'Ver';
        });

        button.dataset.bound = 'true';
    });
}

function initLoginPage() {
    const form = document.getElementById('loginForm');
    if (!form) return;

    if (isLoggedIn()) {
        const user = getCurrentUser();
        if (user?.tipo === 'comprador') {
            window.location.href = 'dashboard.html';
            return;
        }
        if (user) {
            window.location.href = 'dashboard-dados.html';
            return;
        }
    }

    initPasswordToggles();

    form.addEventListener('submit', async (event) => {
        event.preventDefault();

        const email = document.getElementById('email').value;
        const senha = document.getElementById('senha').value;
        const rememberMe = document.getElementById('rememberMe')?.checked || false;

        if (!email || !senha) {
            showAlert('error', 'Campos obrigatorios', 'Por favor, preencha todos os campos.');
            return;
        }

        await login(email, senha, rememberMe);
    });
}

function initForgotPasswordPage() {
    const requestForm = document.getElementById('forgotPasswordRequestForm');
    const resetForm = document.getElementById('forgotPasswordResetForm');
    if (!requestForm || !resetForm) return;

    initPasswordToggles();

    requestForm.addEventListener('submit', async (event) => {
        event.preventDefault();

        const email = document.getElementById('resetEmail')?.value?.trim();
        if (!email) {
            showAlert('error', 'Email obrigatorio', 'Informe seu email para receber o codigo.');
            return;
        }

        const response = await requestPasswordReset(email);
        if (!response) return;

        const confirmEmailInput = document.getElementById('resetEmailConfirm');
        if (confirmEmailInput) {
            confirmEmailInput.value = email;
        }

        showAlert('success', 'Codigo enviado', response.mensagem);
    });

    resetForm.addEventListener('submit', async (event) => {
        event.preventDefault();

        const email = document.getElementById('resetEmailConfirm')?.value?.trim();
        const codigo = document.getElementById('resetCodigo')?.value?.trim();
        const novaSenha = document.getElementById('resetNovaSenha')?.value || '';

        if (!email || !codigo || !novaSenha) {
            showAlert('error', 'Campos obrigatorios', 'Preencha email, codigo e nova senha.');
            return;
        }

        const response = await confirmPasswordReset(email, codigo, novaSenha);
        if (!response) return;

        showAlert('success', 'Senha redefinida', response.mensagem);
        resetForm.reset();

        setTimeout(() => {
            window.location.href = 'login.html';
        }, 1200);
    });
}

function initAgendamentoPage() {
    initDatePicker();
    loadCompradores();

    const telefoneInput = document.getElementById('telefoneVendedor');
    if (telefoneInput) {
        telefoneInput.addEventListener('input', (event) => {
            event.target.value = formatPhone(event.target.value);
        });
    }

    const form = document.getElementById('formAgendamento');
    if (form) {
        form.addEventListener('submit', async (event) => {
            event.preventDefault();

            if (!selectedComprador || !selectedTime) {
                showAlert('error', 'Selecao incompleta', 'Selecione um comprador e um horario.');
                return;
            }

            const dados = {
                comprador_id: selectedComprador.id,
                data_hora: selectedTime,
                nome_vendedor: document.getElementById('nomeVendedor').value,
                empresa_vendedor: document.getElementById('empresaVendedor').value || null,
                telefone_vendedor: document.getElementById('telefoneVendedor').value || null,
                email_vendedor: document.getElementById('emailVendedor').value,
                observacoes: document.getElementById('observacoes').value || null
            };

            await criarAgendamento(dados);
        });
    }
}

function initMinhasVisitasPage() {
    const form = document.getElementById('buscarVisitasForm');
    const telefoneInput = document.getElementById('telefoneBusca');
    const container = document.getElementById('visitasList');

    if (telefoneInput) {
        telefoneInput.addEventListener('input', (event) => {
            event.target.value = formatPhone(event.target.value);
        });
    }

    if (!form || !container) return;

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const telefone = telefoneInput.value;
        currentVisitPhoneSearch = telefone;
        const visitas = await loadMinhasVisitas(telefone);

        if (!visitas.length) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">VS</div>
                    <div class="empty-title">Nenhuma visita encontrada</div>
                    <div class="empty-description">Nao encontramos visitas para esse telefone.</div>
                </div>
            `;
            return;
        }

        container.innerHTML = visitas.map((visita) => `
            <div class="card mb-3 fade-in">
                <div class="card-body">
                    <div style="display:flex; justify-content:space-between; align-items:start; flex-wrap:wrap; gap:16px;">
                        <div>
                            <h3 style="font-size:18px; font-weight:700; margin-bottom:8px;">
                                ${visita.nome_comprador}
                                <span class="badge badge-${visita.status}">${visita.status}</span>
                            </h3>
                            <p class="text-muted mb-2"><strong>Data:</strong> ${formatDate(visita.data_hora)}</p>
                            <p class="text-muted mb-2"><strong>Hora:</strong> ${formatTime(visita.data_hora)}</p>
                            <p class="text-muted mb-2"><strong>Comprador:</strong> ${visita.nome_comprador}</p>
                            <p class="text-muted mb-2"><strong>Empresa:</strong> ${visita.empresa_vendedor || 'Nao informada'}</p>
                            <p class="text-muted mb-2"><strong>Telefone informado:</strong> ${visita.telefone_vendedor || '-'}</p>
                            ${visita.observacoes ? `<p class="text-muted"><strong>Obs:</strong> ${visita.observacoes}</p>` : ''}
                            ${visita.motivo_vendedor ? `<p class="text-muted"><strong>Motivo informado:</strong> ${visita.motivo_vendedor}</p>` : ''}
                            ${renderVisitaPublicaActions(visita)}
                        </div>
                    </div>
                </div>
            </div>
        `).join('');
    });
}

function renderVisitaPublicaActions(visita) {
    if (!['pendente', 'confirmado'].includes(visita.status)) {
        return '';
    }

    return `
        <div class="visit-public-actions">
            <button class="btn btn-danger btn-sm" type="button" onclick="toggleDesistenciaForm(${visita.id})">
                Desistir da visita
            </button>
            <div class="visit-desistencia-form hidden" id="desistenciaForm-${visita.id}">
                <label class="form-label" for="desistenciaMotivo-${visita.id}">Motivo da desistencia</label>
                <textarea id="desistenciaMotivo-${visita.id}" class="form-control" rows="3" placeholder="Informe o motivo da desistencia"></textarea>
                <div class="visit-desistencia-actions">
                    <button class="btn btn-secondary btn-sm" type="button" onclick="toggleDesistenciaForm(${visita.id}, true)">Cancelar</button>
                    <button class="btn btn-primary btn-sm" type="button" onclick="submitDesistenciaVisita(${visita.id})">Concluir</button>
                </div>
            </div>
        </div>
    `;
}

function toggleDesistenciaForm(id, forceClose = false) {
    const form = document.getElementById(`desistenciaForm-${id}`);
    if (!form) return;

    if (forceClose) {
        form.classList.add('hidden');
        return;
    }

    form.classList.toggle('hidden');
}

async function submitDesistenciaVisita(id) {
    const motivoEl = document.getElementById(`desistenciaMotivo-${id}`);
    const motivo = motivoEl?.value?.trim();

    if (!motivo) {
        showAlert('warning', 'Motivo obrigatorio', 'Informe o motivo da desistencia para concluir.');
        return;
    }

    const result = await desistirMinhaVisita(id, currentVisitPhoneSearch, motivo);
    if (result) {
        showAlert('success', 'Desistencia registrada', 'Sua visita foi marcada como desistida.');
        const visitas = await loadMinhasVisitas(currentVisitPhoneSearch);
        const container = document.getElementById('visitasList');
        if (!container) return;

        if (!visitas.length) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">VS</div>
                    <div class="empty-title">Nenhuma visita encontrada</div>
                    <div class="empty-description">Nao encontramos visitas para esse telefone.</div>
                </div>
            `;
            return;
        }

        container.innerHTML = visitas.map((visita) => `
            <div class="card mb-3 fade-in">
                <div class="card-body">
                    <div style="display:flex; justify-content:space-between; align-items:start; flex-wrap:wrap; gap:16px;">
                        <div>
                            <h3 style="font-size:18px; font-weight:700; margin-bottom:8px;">
                                ${visita.nome_comprador}
                                <span class="badge badge-${visita.status}">${visita.status}</span>
                            </h3>
                            <p class="text-muted mb-2"><strong>Data:</strong> ${formatDate(visita.data_hora)}</p>
                            <p class="text-muted mb-2"><strong>Hora:</strong> ${formatTime(visita.data_hora)}</p>
                            <p class="text-muted mb-2"><strong>Comprador:</strong> ${visita.nome_comprador}</p>
                            <p class="text-muted mb-2"><strong>Empresa:</strong> ${visita.empresa_vendedor || 'Nao informada'}</p>
                            <p class="text-muted mb-2"><strong>Telefone informado:</strong> ${visita.telefone_vendedor || '-'}</p>
                            ${visita.observacoes ? `<p class="text-muted"><strong>Obs:</strong> ${visita.observacoes}</p>` : ''}
                            ${visita.motivo_vendedor ? `<p class="text-muted"><strong>Motivo informado:</strong> ${visita.motivo_vendedor}</p>` : ''}
                            ${renderVisitaPublicaActions(visita)}
                        </div>
                    </div>
                </div>
            </div>
        `).join('');
    }
}

function initDashboardPage() {
    if (!isLoggedIn()) {
        window.location.href = 'login.html';
        return;
    }

    if (!hasRole(['comprador'])) {
        window.location.href = 'usuarios.html';
        return;
    }

    currentUser = getCurrentUser();
    updateCurrentUserUI();
    initProfileMenu();
    syncProfileNav();

    setupTabs();
    renderAgendamentos();
}

function initUsuariosPage() {
    if (!isLoggedIn()) {
        window.location.href = 'login.html';
        return;
    }

    currentUser = getCurrentUser();
    if (!currentUser) {
        window.location.href = 'login.html';
        return;
    }

    if (currentUser.tipo === 'comprador') {
        window.location.href = 'dashboard.html';
        return;
    }

    updateCurrentUserUI();
    initProfileMenu();
    syncProfileNav();

    const tipoSelect = document.getElementById('tipoUsuario');
    if (tipoSelect && currentUser.tipo === 'administrador') {
        tipoSelect.innerHTML = '<option value="comprador">comprador</option>';
    }

    const form = document.getElementById('usuarioForm');
    if (form) {
        form.addEventListener('submit', async (event) => {
            event.preventDefault();

            const payload = {
                nome: document.getElementById('nomeUsuario').value,
                email: document.getElementById('emailUsuario').value,
                senha: document.getElementById('senhaUsuario').value,
                tipo: document.getElementById('tipoUsuario').value,
                ativo: document.getElementById('ativoUsuario').checked
            };

            const usuarioCriado = await criarUsuarioSistema(payload);
            if (usuarioCriado) {
                showAlert('success', 'Usuario criado', `Usuario ${usuarioCriado.nome} criado com sucesso.`);
                form.reset();
                const ativoEl = document.getElementById('ativoUsuario');
                if (ativoEl) ativoEl.checked = true;
                renderUsuarios();
            }
        });
    }

    renderUsuarios();
}

function initDashboardDadosPage() {
    if (!isLoggedIn()) {
        window.location.href = 'login.html';
        return;
    }

    currentUser = getCurrentUser();
    if (!currentUser) {
        window.location.href = 'login.html';
        return;
    }

    if (!hasRole(['administrador', 'desenvolvedor'])) {
        window.location.href = currentUser.tipo === 'comprador' ? 'dashboard.html' : 'login.html';
        return;
    }

    updateCurrentUserUI();
    initProfileMenu();
    syncProfileNav();
    renderDashboardDados();
}

function initPerfilPage() {
    if (!isLoggedIn()) {
        window.location.href = 'login.html';
        return;
    }

    currentUser = getCurrentUser();
    if (!currentUser) {
        window.location.href = 'login.html';
        return;
    }

    updateCurrentUserUI();
    initProfileMenu();
    syncProfileNav();
    initPasswordToggles();
    loadMeuPerfil().then((user) => {
        if (!user) return;
        const nomeEl = document.getElementById('perfilNome');
        const emailEl = document.getElementById('perfilEmail');
        const telefoneEl = document.getElementById('perfilTelefone');
        const tipoEl = document.getElementById('perfilTipo');

        if (nomeEl) nomeEl.value = user.nome || '';
        if (emailEl) emailEl.value = user.email || '';
        if (telefoneEl) telefoneEl.value = formatPhone(user.telefone || '');
        if (tipoEl) tipoEl.value = user.tipo || '';
        const buyerWhatsappGroup = document.getElementById('buyerWhatsappGroup');
        const mensagemWhatsappEl = document.getElementById('perfilMensagemWhatsapp');
        if (buyerWhatsappGroup) {
            buyerWhatsappGroup.classList.toggle('hidden', user.tipo !== 'comprador');
        }
        if (mensagemWhatsappEl) {
            mensagemWhatsappEl.value = user.mensagem_whatsapp || '';
        }
        updateCurrentUserUI();
        syncProfileNav();
    });

    const telefoneEl = document.getElementById('perfilTelefone');
    if (telefoneEl) {
        telefoneEl.addEventListener('input', (event) => {
            event.target.value = formatPhone(event.target.value);
        });
    }

    const fotoInput = document.getElementById('perfilFoto');
    if (fotoInput) {
        fotoInput.addEventListener('change', async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            const preview = document.getElementById('profilePreview');
            const dataUrl = await readFileAsDataUrl(file);
            if (preview) {
                preview.src = dataUrl;
                preview.style.display = 'block';
                preview.dataset.pendingValue = dataUrl;
            }
            const placeholder = document.getElementById('profilePlaceholder');
            if (placeholder) {
                placeholder.style.display = 'none';
            }
        });
    }

    const form = document.getElementById('perfilForm');
    if (form) {
        form.addEventListener('submit', async (event) => {
            event.preventDefault();

            const preview = document.getElementById('profilePreview');
            const payload = {
                nome: document.getElementById('perfilNome').value,
                email: document.getElementById('perfilEmail').value,
                telefone: document.getElementById('perfilTelefone').value,
                foto_url: preview?.dataset?.pendingValue ?? currentUser?.foto_url ?? null
            };
            const mensagemWhatsappEl = document.getElementById('perfilMensagemWhatsapp');
            if (currentUser?.tipo === 'comprador' && mensagemWhatsappEl) {
                payload.mensagem_whatsapp = mensagemWhatsappEl.value || null;
            }

            const senhaAtual = document.getElementById('senhaAtual').value;
            const novaSenha = document.getElementById('novaSenha').value;
            if (novaSenha) {
                payload.senha_atual = senhaAtual;
                payload.nova_senha = novaSenha;
            }

            const user = await atualizarMeuPerfil(payload);
            if (user) {
                showAlert('success', 'Perfil atualizado', 'Seus dados foram salvos com sucesso.');
                form.reset();
                document.getElementById('perfilNome').value = user.nome || '';
                document.getElementById('perfilEmail').value = user.email || '';
                document.getElementById('perfilTelefone').value = formatPhone(user.telefone || '');
                document.getElementById('perfilTipo').value = user.tipo || '';
                if (mensagemWhatsappEl) {
                    mensagemWhatsappEl.value = user.mensagem_whatsapp || '';
                }
                if (preview) {
                    preview.src = user.foto_url || '';
                    preview.style.display = user.foto_url ? 'block' : 'none';
                    preview.dataset.pendingValue = user.foto_url || '';
                }
                const placeholder = document.getElementById('profilePlaceholder');
                if (placeholder) {
                    placeholder.style.display = user.foto_url ? 'none' : 'block';
                }
            }
        });
    }
}

function initDisponibilidadePage() {
    if (!isLoggedIn()) {
        window.location.href = 'login.html';
        return;
    }

    currentUser = getCurrentUser();
    if (!currentUser) {
        window.location.href = 'login.html';
        return;
    }

    if (!hasRole(['comprador'])) {
        window.location.href = 'usuarios.html';
        return;
    }

    updateCurrentUserUI();
    initProfileMenu();
    syncProfileNav();

    const monthFilter = document.getElementById('mesDisponibilidade');
    const dateTimeInput = document.getElementById('novaDisponibilidade');
    const form = document.getElementById('disponibilidadeForm');

    if (monthFilter) {
        monthFilter.value = formatMonthInput(new Date());
        monthFilter.addEventListener('change', () => {
            renderMinhasDisponibilidades();
        });
    }

    if (dateTimeInput) {
        const nextSlot = getNextAvailableSlot();
        dateTimeInput.min = formatDateTimeLocal(nextSlot);
        dateTimeInput.step = 1800;
        dateTimeInput.value = formatDateTimeLocal(nextSlot);
    }

    if (form) {
        form.addEventListener('submit', async (event) => {
            event.preventDefault();

            if (!dateTimeInput?.value) {
                showAlert('error', 'Horario obrigatorio', 'Escolha o dia e a hora que deseja liberar.');
                return;
            }

            const created = await criarMinhaDisponibilidade({
                data_hora: dateTimeInput.value
            });

            if (created) {
                showAlert('success', 'Horario cadastrado', 'O horario livre foi publicado para os vendedores.');
                const selectedDate = new Date(`${dateTimeInput.value}:00`);
                if (monthFilter) {
                    monthFilter.value = formatMonthInput(selectedDate);
                }
                const nextSlot = getNextAvailableSlot();
                dateTimeInput.min = formatDateTimeLocal(nextSlot);
                dateTimeInput.value = formatDateTimeLocal(nextSlot);
                renderMinhasDisponibilidades();
            }
        });
    }

    renderMinhasDisponibilidades();
}

document.addEventListener('DOMContentLoaded', () => {
    const page = document.body.dataset.page;
    if (!enforcePageAccess(page)) {
        return;
    }

    switch (page) {
        case 'login':
            initLoginPage();
            break;
        case 'esqueci-senha':
            initForgotPasswordPage();
            break;
        case 'agendamento':
            initAgendamentoPage();
            break;
        case 'minhas-visitas':
            initMinhasVisitasPage();
            break;
        case 'dashboard':
            initDashboardPage();
            break;
        case 'usuarios':
            initUsuariosPage();
            break;
        case 'dashboard-dados':
            initDashboardDadosPage();
            break;
        case 'perfil':
            initPerfilPage();
            break;
        case 'disponibilidade':
            initDisponibilidadePage();
            break;
        default:
            hideLoading();
    }
});
