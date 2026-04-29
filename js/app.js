/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  AJKC ANARCHY — Main Application Logic                         ║
 * ║  All Japan Kendo Championship Bracket Prediction Game           ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * ARCHITECTURE OVERVIEW
 * ─────────────────────
 * Single-page app with two main screens:
 *   1. Landing Page (#landingPage) — hero, countdown, how-to-play
 *   2. Main App (#mainApp) — bracket picking, leaderboard, stats, etc.
 *
 * The app object is a singleton that manages all state and rendering.
 * Views are swapped by setting `currentView` and calling `render()`.
 * Firebase Firestore is used for persistence (brackets, results, settings).
 * Firebase Auth handles anonymous + Google + email link authentication.
 *
 * STATE MACHINE (bracket game flow)
 * ─────────────────────────────────
 *   picking → round-summary → picking → ... → round-summary
 *     → post-finals-login → post-finals-submit → post-finals-thanks
 *     → bracket-summary
 *
 * NAVIGATION (currentView)
 * ────────────────────────
 *   'bracket'      — My bracket (picking or summary)
 *   'leaderboard'  — Ranked bracket scores
 *   'stats'        — Tournament-wide statistics
 *   'allBrackets'  — Searchable list of all submissions
 *   'liveBracket'  — Official tournament results bracket
 *   'faq'          — Frequently asked questions
 *   'donate'       — Support/donate page
 *   'legal'        — Privacy policy & terms of service
 *
 * ASYNC RACE CONDITION GUARD (_navGen)
 * ────────────────────────────────────
 * Many methods are async (Firebase reads). If the user navigates away
 * before a read completes, the stale callback could overwrite the new
 * page. `_navGen` is incremented on every navigation; async methods
 * capture it at start and bail if it changed before rendering.
 *
 * COLOR SYSTEM
 * ────────────
 * Men's bracket: gold (#d4a843) — set via --primary CSS variable
 * Women's bracket: red (#cc3333) — swapped via body.women class
 * All UI elements use semi-transparent versions (30% opacity) of these
 * colors for a consistent, muted aesthetic.
 *
 * FIRESTORE COLLECTIONS
 * ─────────────────────
 *   brackets-men/{uid}      — User bracket predictions (men's)
 *   brackets-women/{uid}    — User bracket predictions (women's)
 *   actualResults-men/current — Official tournament results (men's)
 *   actualResults-women/current — Official tournament results (women's)
 *   settings/tournament     — Lock status
 *   settings/actualTechnique-{gender} — Final ippon technique
 *   admins/{email}          — Admin whitelist
 *
 * BRACKET DATA STRUCTURE
 * ──────────────────────
 *   bracket = {
 *     0: { 0: playerId, 1: playerId, ... },  // Round of 64 (32 matches)
 *     1: { 0: playerId, 1: playerId, ... },  // Round of 32 (16 matches)
 *     ...
 *     5: { 0: playerId }                      // Finals (1 match)
 *   }
 *
 * FILES
 * ─────
 *   app.js            — This file: app logic, state, rendering, Firebase
 *   ui.js             — HTML template rendering (card matchup, bracket summary)
 *   data.js           — Player data arrays (menPlayersData, womenPlayersData)
 *   firebase-config.js — Firebase initialization
 *   styles.css        — All styling (dark theme, responsive, animations)
 *   index.html        — DOM structure (landing page, main app, modals)
 */

// Round name constants used throughout the app
const ROUND_NAMES = ['Round of 64', 'Round of 32', 'Round of 16', 'Quarterfinals', 'Semifinals', 'Finals'];
const ROUND_NAMES_SHORT = ['R64', 'R32', 'R16', 'QF', 'SF', 'F'];
const ROUND_NAMES_JP = ['1回戦', '2回戦', '3回戦', '準々決勝', '準決勝', '決勝'];
const ROUND_INTENSITY = [0, 0.15, 0.3, 0.5, 0.75, 1.0]; // Progressive atmosphere intensity per round

/** Display a toast notification. Types: 'info', 'success', 'error' */
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) { console.log(message); return; }
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// ── Modal body scroll lock ──────────────────────────────────
function lockBodyScroll() { document.body.classList.add('modal-open'); }
function unlockBodyScroll() { document.body.classList.remove('modal-open'); }

/**
 * Bracket pinch-to-zoom handler for mobile devices.
 * Adds two-finger zoom, single-finger pan, and +/-/reset buttons.
 * Attaches to the .bracket-tree-wrapper element.
 * Sets wrapper._isManualZoom flag so the resize watcher can skip auto-scaling.
 */
function initBracketPinchZoom(wrapper) {
    if (!wrapper || wrapper._pinchInited) return;
    wrapper._pinchInited = true;

    let minScale = 0.2, maxScale = 3;
    let panX = 0, panY = 0;
    let startDist = 0, startScale = 1;
    let startPanX = 0, startPanY = 0;
    let startMidX = 0, startMidY = 0;
    let isPanning = false, startPointerX = 0, startPointerY = 0;
    let isManualZoom = false;

    const bracket = wrapper.querySelector('.ncaa-bracket');
    if (!bracket) return;

    function getBaseScale() {
        const bracketW = bracket.scrollWidth;
        const wrapperW = wrapper.clientWidth;
        return (bracketW > wrapperW && bracketW > 0) ? wrapperW / bracketW : 1;
    }
    let scale = getBaseScale();

    // Add zoom control buttons
    let controls = wrapper.querySelector('.bracket-zoom-controls');
    if (!controls) {
        controls = document.createElement('div');
        controls.className = 'bracket-zoom-controls';
        controls.innerHTML = `
            <button class="bracket-zoom-btn" data-zoom="in" title="Zoom in">+</button>
            <button class="bracket-zoom-btn" data-zoom="out" title="Zoom out">\u2212</button>
            <button class="bracket-zoom-btn" data-zoom="reset" title="Reset zoom">↺</button>`;
        wrapper.appendChild(controls);
    }

    // Expose manual zoom flag so resize watcher can check
    wrapper._isManualZoom = () => isManualZoom;

    function applyTransform() {
        isManualZoom = true;
        bracket.style.transformOrigin = '0 0';
        bracket.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
        const origH = bracket.offsetHeight || bracket.scrollHeight;
        wrapper.style.height = Math.max(origH * scale + 16, 200) + 'px';
        wrapper.style.overflow = 'hidden';
    }

    function resetZoom() {
        isManualZoom = false;
        panX = 0; panY = 0;
        bracket.style.transform = '';
        bracket.style.transformOrigin = '';
        wrapper.style.height = '';
        wrapper.style.overflow = '';
        if (typeof app !== 'undefined' && app._scaleBracketToFit) {
            app._resetBracketScale();
            app._scaleBracketToFit();
        }
        scale = getBaseScale();
    }

    function getTouchDist(t1, t2) {
        const dx = t1.clientX - t2.clientX;
        const dy = t1.clientY - t2.clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    wrapper.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            e.preventDefault();
            startDist = getTouchDist(e.touches[0], e.touches[1]);
            startScale = scale;
            startPanX = panX; startPanY = panY;
            const r = wrapper.getBoundingClientRect();
            startMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left;
            startMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top;
        } else if (e.touches.length === 1 && isManualZoom) {
            isPanning = true;
            startPointerX = e.touches[0].clientX;
            startPointerY = e.touches[0].clientY;
            startPanX = panX; startPanY = panY;
        }
    }, { passive: false });

    wrapper.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2) {
            e.preventDefault();
            const dist = getTouchDist(e.touches[0], e.touches[1]);
            const newScale = Math.min(maxScale, Math.max(minScale, startScale * (dist / startDist)));
            const r = wrapper.getBoundingClientRect();
            const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left;
            const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top;
            panX = midX - (startMidX - startPanX) * (newScale / startScale);
            panY = midY - (startMidY - startPanY) * (newScale / startScale);
            scale = newScale;
            applyTransform();
        } else if (e.touches.length === 1 && isPanning) {
            e.preventDefault();
            panX = startPanX + (e.touches[0].clientX - startPointerX);
            panY = startPanY + (e.touches[0].clientY - startPointerY);
            applyTransform();
        }
    }, { passive: false });

    wrapper.addEventListener('touchend', () => { isPanning = false; });

    controls.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-zoom]');
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        const action = btn.dataset.zoom;
        if (action === 'in') { scale = Math.min(maxScale, scale * 1.4); applyTransform(); }
        else if (action === 'out') { scale = Math.max(minScale, scale / 1.4); applyTransform(); }
        else if (action === 'reset') { resetZoom(); }
    });
}

const app = {
    // ── Player & bracket data ───────────────────────────────────
    players: [],              // Active player list (points to menPlayers or womenPlayers)
    menPlayers: [],           // Men's player array with IDs, built from data.js
    womenPlayers: [],         // Women's player array with IDs, built from data.js
    bracket: {},              // Current bracket picks: { round: { matchIndex: playerId } }
    userBracketData: null,    // Saved bracket from Firestore (null if no submission yet)
    actualResults: null,      // Official tournament results (null until admin enters them)

    // ── Auth & admin ────────────────────────────────────────────
    currentUser: null,        // Firebase auth user object
    isAdmin: false,           // Whether current user is in the admins collection
    adminMode: false,         // Admin editing mode toggle

    // ── UI state ────────────────────────────────────────────────
    isLocked: false,          // Whether bracket submissions are locked
    championChart: null,      // Chart.js instance (unused, legacy)
    currentGender: 'men',     // Active gender: 'men' | 'women'
    viewingOtherBracket: false, // True when viewing someone else's bracket
    _viewingBracketName: '',  // Display name of the bracket being viewed
    _pickHistory: [],         // Undo stack for bracket picks

    // ── Game flow state ─────────────────────────────────────────
    // gameState controls what's shown within the bracket view:
    //   'picking'            — Card-by-card matchup selection
    //   'round-summary'      — Winners list after completing a round
    //   'post-finals-login'  — Sign-in prompt after finishing all picks
    //   'post-finals-submit' — Name/country/ippon form
    //   'post-finals-thanks' — Confirmation screen
    //   'bracket-summary'    — Full bracket tree overview
    gameState: 'picking',
    // currentView controls which page is shown:
    //   'bracket' | 'leaderboard' | 'stats' | 'allBrackets' |
    //   'liveBracket' | 'faq' | 'donate' | 'legal'
    currentView: 'bracket',
    gameRound: 0,             // Current round index (0-5) during picking
    gameMatch: 0,             // Current match index within the round
    _advanceTimeout: null,    // setTimeout ID for auto-advance after pick
    _navGen: 0,               // Navigation generation counter — see file header

    // ── Initialisation ──────────────────────────────────────────

    // Tournament date — change this to the actual date
    tournamentDate: new Date('2026-11-03T09:00:00+09:00'),

    /** Bootstrap the app: build player lists, start countdown, check for share links */
    async init() {
        this.buildPlayerLists();
        this.players = this.menPlayers;
        this.startCountdown();
        this.loadLandingStats();
        this._checkShareLink();
        this._initClickOutsideNav();
        this._initOfflineDetector();
        this._initKeyboardNav();
    },

    /** Close mobile nav when clicking outside it (both landing and app navs) */
    _initClickOutsideNav() {
        document.addEventListener('click', (e) => {
            // Landing nav
            const landingNav = document.querySelector('.landing-nav');
            const landingLinks = document.querySelector('.landing-nav-links');
            if (landingLinks && landingLinks.classList.contains('landing-nav-open') &&
                !e.target.closest('.landing-nav-links') && !e.target.closest('.landing-menu-btn')) {
                landingLinks.classList.remove('landing-nav-open');
            }
            // App nav
            const appNav = document.querySelector('.app-nav');
            if (appNav && appNav.classList.contains('nav-open') &&
                !e.target.closest('.app-nav') && !e.target.closest('.mobile-menu-btn')) {
                appNav.classList.remove('nav-open');
            }
        });
    },

    /** Show/hide offline banner based on navigator.onLine */
    _initOfflineDetector() {
        const banner = document.getElementById('offlineBanner');
        if (!banner) return;
        const show = () => banner.classList.add('visible');
        const hide = () => banner.classList.remove('visible');
        window.addEventListener('offline', show);
        window.addEventListener('online', () => {
            hide();
            showToast('Back online', 'success');
        });
        if (!navigator.onLine) show();
    },

    /** Keyboard shortcuts: arrows/1/2 to pick, Ctrl+Z to undo, Enter to advance */
    _initKeyboardNav() {
        document.addEventListener('keydown', (e) => {
            // Only during picking state in bracket view
            if (this.currentView !== 'bracket' || this.gameState !== 'picking') return;
            // Don't intercept when typing in an input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

            const matches = this.getRoundMatches(this.gameRound);
            const match = matches[this.gameMatch];
            if (!match) return;

            switch (e.key) {
                case '1':
                case 'ArrowLeft':
                    if (match.player1) { e.preventDefault(); this.pickWinner(this.gameRound, this.gameMatch, match.player1.id); }
                    break;
                case '2':
                case 'ArrowRight':
                    if (match.player2) { e.preventDefault(); this.pickWinner(this.gameRound, this.gameMatch, match.player2.id); }
                    break;
                case 'ArrowDown':
                case 'Enter':
                    e.preventDefault();
                    if (this.bracket[this.gameRound]?.[this.gameMatch]) this.nextMatch();
                    break;
                case 'ArrowUp':
                case 'Backspace':
                    e.preventDefault();
                    this.prevMatch();
                    break;
                case 'z':
                    if (e.ctrlKey || e.metaKey) { e.preventDefault(); this.undoLastPick(); }
                    break;
            }
        });
    },

    /** Called after entering from landing page */
    async initBracket() {
        await this.checkLockStatus();
        await this.loadActualResults();
        this.render();
        this.updateLeaderboard();
        await this.updateBracketCount();
    },

    // ── Landing page ────────────────────────────────────────────

    /** Update the countdown timer on the landing page every second */
    startCountdown() {
        const update = () => {
            const now = new Date();
            const diff = this.tournamentDate - now;
            if (diff <= 0) {
                document.getElementById('countdown').innerHTML =
                    '<div class="countdown-label" style="color:var(--kendo-gold);">Tournament has begun! / 大会開催中！</div>';
                return;
            }
            const d = Math.floor(diff / 86400000);
            const h = Math.floor((diff % 86400000) / 3600000);
            const m = Math.floor((diff % 3600000) / 60000);
            const s = Math.floor((diff % 60000) / 1000);
            document.getElementById('cdDays').textContent = d;
            document.getElementById('cdHours').textContent = String(h).padStart(2, '0');
            document.getElementById('cdMins').textContent = String(m).padStart(2, '0');
            document.getElementById('cdSecs').textContent = String(s).padStart(2, '0');
        };
        update();
        setInterval(update, 1000);
    },

    /** Fetch total bracket count from Firestore and display on landing page */
    async loadLandingStats() {
        try {
            const [menSnap, womenSnap] = await Promise.all([
                db.collection('brackets-men').get(),
                db.collection('brackets-women').get()
            ]);
            const total = menSnap.size + womenSnap.size;
            const el = document.getElementById('landingStats');
            if (total > 0) {
                const locations = new Set();
                menSnap.forEach(doc => { const loc = doc.data().location; if (loc) locations.add(loc); });
                womenSnap.forEach(doc => { const loc = doc.data().location; if (loc) locations.add(loc); });
                const locText = locations.size > 1 ? ` from ${locations.size} countries` : '';
                el.textContent = `${total} bracket${total !== 1 ? 's' : ''} submitted${locText} so far — add yours today!`;
            }
        } catch (e) { console.error('Landing stats error:', e); }
    },

    /** Transition from landing page to main app and start the bracket for given gender */
    async enterBracket(gender) {
        // Hide landing, show app
        document.getElementById('landingPage').style.display = 'none';
        // Clear stale content before showing
        const gameArea = document.getElementById('gameArea');
        if (gameArea) gameArea.innerHTML = '';
        document.getElementById('mainApp').style.display = 'block';
        this._navGen++;
        this.currentView = 'bracket';
        this.gameState = 'picking';

        await this.switchGender(gender);
    },

    /** Return to the landing page from the main app (with unsaved-picks warning) */
    goHome() {
        if (!this.viewingOtherBracket && this.hasAnyPicks() && !this.userBracketData) {
            if (!confirm('You have unsaved picks. Leave anyway?')) return;
        }
        this._closeNav();
        this._navGen++;
        document.querySelector('.landing-nav-links')?.classList.remove('landing-nav-open');
        this.currentView = 'bracket';
        this.gameState = 'picking';
        this.gameRound = 0;
        this.gameMatch = 0;
        this._pickHistory = [];
        document.getElementById('mainApp').style.display = 'none';
        document.getElementById('landingPage').style.display = 'block';
        this.loadLandingStats();
    },

    /** Convert raw player data arrays into player objects with sequential IDs */
    buildPlayerLists() {
        this.menPlayers = menPlayersData.map((p, i) => ({ id: i + 1, ...p }));
        this.womenPlayers = womenPlayersData.map((p, i) => ({ id: i + 1, ...p }));
    },

    // ── Authentication ──────────────────────────────────────────

    /** Ensure user has at least anonymous auth (required for Firestore reads) */
    async ensureAnonymousAuth() {
        if (!auth.currentUser) {
            try { await auth.signInAnonymously(); }
            catch (e) { console.error('Anonymous auth error:', e); }
        }
    },

    /** Sign in with Google. Links to anonymous account if one exists. Returns false on failure */
    async signInWithGoogle() {
        const provider = new firebase.auth.GoogleAuthProvider();
        try {
            if (auth.currentUser && auth.currentUser.isAnonymous) {
                await auth.currentUser.linkWithPopup(provider);
            } else {
                await auth.signInWithPopup(provider);
            }
        } catch (error) {
            if (error.code === 'auth/credential-already-in-use' ||
                error.code === 'auth/email-already-in-use') {
                await auth.signInWithCredential(error.credential);
            } else if (error.code === 'auth/popup-blocked') {
                await auth.signInWithRedirect(provider);
            } else {
                console.error('Google sign-in error:', error);
                showToast('Google sign-in failed. Please try again.', 'error');
                return false;
            }
        }
        return true;
    },

    /** Firebase auth state change handler. Checks admin status and loads user bracket */
    async onAuth(user) {
        this.currentUser = user;
        if (user && !user.isAnonymous && user.email) {
            try {
                const doc = await db.collection('admins').doc(user.email).get();
                this.isAdmin = doc.exists;
            } catch { this.isAdmin = false; }
        } else {
            this.isAdmin = false;
        }
        UI.updateAuthUI(this.isAdmin);
        this._updateAccountBtn();
        // Skip reloading if migration is handling it
        if (!this._migrating) {
            await this.loadUserBracket();
        }
    },

    // ── Account / Sign-in ───────────────────────────────────────

    /** Update sign-in button text and MY BRACKET link visibility across both navs */
    _updateAccountBtn() {
        const btn = document.getElementById('accountBtn');
        const landingBtn = document.getElementById('landingSignIn');
        const landingMyBracket = document.getElementById('landingMyBracket');
        const user = this.currentUser;
        const signedIn = user && !user.isAnonymous && user.email;
        if (btn) {
            btn.textContent = signedIn ? 'SIGNED IN' : 'SIGN IN';
            btn.title = signedIn ? user.email : 'Sign in';
            btn.style.color = signedIn ? 'var(--kendo-gold)' : '';
        }
        if (landingBtn) {
            landingBtn.textContent = signedIn ? 'SIGNED IN' : 'SIGN IN';
        }
        if (landingMyBracket) {
            landingMyBracket.style.display = signedIn ? '' : 'none';
        }
    },

    /** Highlight the active nav tab by ID, removing active from all others */
    _setActiveNav(id) {
        document.querySelectorAll('.app-nav .nav-link').forEach(btn => btn.classList.remove('active'));
        const el = document.getElementById(id);
        if (el) el.classList.add('active');
    },

    /** Close the mobile hamburger menu */
    _closeNav() {
        document.querySelector('.app-nav')?.classList.remove('nav-open');
    },

    /** Show the sign-in/account modal (different content if already signed in) */
    showSignInModal() {
        this._closeNav();
        const user = this.currentUser;
        const content = document.getElementById('signInContent');
        if (user && !user.isAnonymous && user.email) {
            content.innerHTML = `
                <div style="padding:20px;text-align:center;">
                    <p style="color:rgba(255,255,255,0.5);font-size:0.8em;margin-bottom:8px;">Signed in as</p>
                    <p style="color:white;font-size:1.1em;font-weight:600;margin-bottom:20px;">${UI.escapeHtml(user.email)}</p>
                    <button class="bracket-action-btn" onclick="app.signOut()">SIGN OUT</button>
                </div>`;
        } else {
            content.innerHTML = `
                <div style="padding:20px;">
                    <p style="color:rgba(255,255,255,0.5);font-size:0.85em;margin-bottom:20px;text-align:center;">
                        Sign in to save your bracket across devices and prevent data loss.
                    </p>
                    <div style="display:flex;flex-direction:column;gap:12px;">
                        <button class="bracket-action-btn bracket-action-gold" onclick="app.upgradeWithGoogle()" style="width:100%;justify-content:center;">
                            SIGN IN WITH GOOGLE
                        </button>
                        <div style="text-align:center;color:rgba(255,255,255,0.3);font-size:0.8em;">or</div>
                        <div style="display:flex;gap:8px;flex-wrap:wrap;">
                            <input type="email" id="emailSignInInput" class="submit-name-input" placeholder="Enter your email" style="flex:1;min-width:180px;" />
                            <button class="bracket-action-btn" onclick="app.sendEmailLink()" style="white-space:nowrap;">SEND LINK</button>
                        </div>
                        <p style="color:rgba(255,255,255,0.3);font-size:0.75em;text-align:center;">
                            We'll send a sign-in link — no password needed.
                        </p>
                    </div>
                </div>`;
        }
        document.getElementById('signInModal').style.display = 'block';
        lockBodyScroll();
    },

    closeSignInModal() {
        document.getElementById('signInModal').style.display = 'none';
        unlockBodyScroll();
    },

    /** Upgrade anonymous account to Google. Migrates brackets if UID changes */
    async upgradeWithGoogle() {
        const oldUid = this.currentUser?.uid;
        const oldBracket = { ...this.bracket };
        const oldUserData = this.userBracketData ? { ...this.userBracketData } : null;
        this._migrating = true;
        try {
            await this.signInWithGoogle();
            const newUid = auth.currentUser?.uid;
            if (oldUid && newUid && oldUid !== newUid && (oldUserData || Object.keys(oldBracket).length > 0)) {
                await this._migrateBracket(oldUid, newUid);
            } else {
                await this.loadUserBracket();
            }
            this._updateAccountBtn();
            this.closeSignInModal();
        } catch (e) {
            console.error('Google upgrade error:', e);
        } finally {
            this._migrating = false;
        }
    },

    /** Copy bracket data from old anonymous UID to new authenticated UID. Verifies write before deleting old */
    async _migrateBracket(oldUid, newUid) {
        try {
            for (const gender of ['men', 'women']) {
                const oldDoc = await db.collection('brackets-' + gender).doc(oldUid).get();
                if (oldDoc.exists) {
                    const newDoc = await db.collection('brackets-' + gender).doc(newUid).get();
                    // Only migrate if new account doesn't already have a bracket
                    if (!newDoc.exists) {
                        await db.collection('brackets-' + gender).doc(newUid).set(oldDoc.data());
                    }
                    // Verify write succeeded before deleting old bracket
                    const verifyDoc = await db.collection('brackets-' + gender).doc(newUid).get();
                    if (verifyDoc.exists) {
                        await db.collection('brackets-' + gender).doc(oldUid).delete();
                    }
                }
            }
            // Reload bracket for current gender
            await this.loadUserBracket();
        } catch (e) {
            console.error('Bracket migration error:', e);
        }
    },

    /** Send a passwordless sign-in link to the user's email */
    async sendEmailLink() {
        const email = document.getElementById('emailSignInInput')?.value?.trim();
        if (!email) { showToast('Please enter your email.', 'error'); return; }
        const actionCodeSettings = {
            url: window.location.href,
            handleCodeInApp: true
        };
        try {
            await auth.sendSignInLinkToEmail(email, actionCodeSettings);
            localStorage.setItem('emailForSignIn', email);
            showToast(`Sign-in link sent to ${email}!`, 'success');
            this.closeSignInModal();
        } catch (e) {
            console.error('Email link error:', e);
            showToast('Error sending email: ' + e.message, 'error');
        }
    },

    /** Complete email link sign-in if the current URL contains a sign-in link */
    async completeEmailSignIn() {
        if (!auth.isSignInWithEmailLink(window.location.href)) return;
        let email = localStorage.getItem('emailForSignIn');
        if (!email) {
            email = prompt('Please enter your email to confirm sign-in:');
            if (!email) return;
        }
        const oldUid = auth.currentUser?.uid;
        try {
            const credential = firebase.auth.EmailAuthProvider.credentialWithLink(email, window.location.href);
            if (auth.currentUser && auth.currentUser.isAnonymous) {
                await auth.currentUser.linkWithCredential(credential);
            } else {
                await auth.signInWithCredential(credential);
            }
            const newUid = auth.currentUser?.uid;
            if (oldUid && newUid && oldUid !== newUid) {
                await this._migrateBracket(oldUid, newUid);
            }
            localStorage.removeItem('emailForSignIn');
            window.history.replaceState(null, '', window.location.pathname);
        } catch (e) {
            console.error('Email sign-in completion error:', e);
            if (e.code === 'auth/credential-already-in-use') {
                await auth.signInWithCredential(e.credential);
                const newUid = auth.currentUser?.uid;
                if (oldUid && newUid && oldUid !== newUid) {
                    await this._migrateBracket(oldUid, newUid);
                }
                localStorage.removeItem('emailForSignIn');
                window.history.replaceState(null, '', window.location.pathname);
            }
        }
    },

    /** Sign out and re-authenticate anonymously */
    async signOut() {
        try {
            await auth.signOut();
            await auth.signInAnonymously();
            this.closeSignInModal();
        } catch (e) {
            console.error('Sign out error:', e);
        }
    },

    /** Capture bracket as PNG using html2canvas and trigger download */
    async shareBracket() {
        let displayName;
        if (this.viewingOtherBracket) {
            displayName = this._viewingBracketName || 'Their';
        } else {
            const nameInput = document.getElementById('submitName') || document.getElementById('userName');
            displayName = nameInput?.value?.trim() || 'My';
        }
        const genderLabel = this.currentGender === 'men' ? "Mens" : "Womens";
        const title = `${displayName}'s ${genderLabel} Bracket`;

        const bracketArea = document.querySelector('.bracket-tree-wrapper');
        if (!bracketArea) {
            showToast('No bracket to share!', 'error');
            return;
        }

        showToast('Generating screenshot...', 'info');

        // Remove scale transform so we capture at full size
        this._resetBracketScale();

        // Temporarily add title header and footer to the bracket area
        const titleEl = document.createElement('div');
        titleEl.className = 'screenshot-title';
        titleEl.style.cssText = "font-family:'Bebas Neue',sans-serif;font-size:1.8em;color:#d4a843;letter-spacing:3px;text-align:center;margin-bottom:4px;padding-top:8px;";
        titleEl.textContent = title;
        const subtitleEl = document.createElement('div');
        subtitleEl.className = 'screenshot-title';
        subtitleEl.style.cssText = "font-family:'Lexend',sans-serif;font-size:0.7em;color:rgba(255,255,255,0.3);text-align:center;margin-bottom:4px;letter-spacing:1px;";
        subtitleEl.textContent = 'AJKC ANARCHY — Bracket Challenge 2026';
        const championName = this._getChampionName();
        const championEl = document.createElement('div');
        championEl.className = 'screenshot-title';
        championEl.style.cssText = "font-family:'Bebas Neue',sans-serif;font-size:1.1em;color:white;text-align:center;margin-bottom:12px;letter-spacing:2px;";
        championEl.innerHTML = championName
            ? 'PREDICTED CHAMPION: <span style="color:#d4a843;">' + UI.escapeHtml(championName) + '</span>'
            : '';
        const footerEl = document.createElement('div');
        footerEl.className = 'screenshot-title';
        footerEl.style.cssText = "font-family:'Bebas Neue',sans-serif;font-size:0.8em;color:rgba(255,255,255,0.2);text-align:center;margin-top:12px;padding-bottom:8px;letter-spacing:2px;";
        footerEl.textContent = 'ajkcanarchy.com';

        // Insert title at top, footer at bottom
        bracketArea.insertBefore(championEl, bracketArea.firstChild);
        bracketArea.insertBefore(subtitleEl, bracketArea.firstChild);
        bracketArea.insertBefore(titleEl, bracketArea.firstChild);
        bracketArea.appendChild(footerEl);

        // Temporarily expand wrapper to full natural size for capture
        const wrapperOldHeight = bracketArea.style.height;
        const wrapperOldOverflow = bracketArea.style.overflow;
        const wrapperOldWidth = bracketArea.style.width;
        const wrapperOldMaxWidth = bracketArea.style.maxWidth;
        const wrapperOldMinWidth = bracketArea.style.minWidth;
        bracketArea.style.height = 'auto';
        bracketArea.style.overflow = 'visible';
        // Expand wrapper to bracket's natural width so capture isn't clipped
        const bracket = bracketArea.querySelector('.ncaa-bracket');
        if (bracket) {
            const naturalW = bracket.scrollWidth + 32;
            bracketArea.style.width = naturalW + 'px';
            bracketArea.style.minWidth = naturalW + 'px';
            bracketArea.style.maxWidth = naturalW + 'px';
        }

        // Redraw SVG lines at full unscaled size
        this.drawBracketSVG();

        try {
            const captureW = bracketArea.scrollWidth;
            const captureH = bracketArea.scrollHeight;
            const canvas = await html2canvas(bracketArea, {
                backgroundColor: '#0d1017',
                scale: 2,
                useCORS: true,
                logging: false,
                scrollX: 0,
                scrollY: -window.scrollY,
                width: captureW,
                height: captureH,
                windowWidth: captureW
            });

            canvas.toBlob(blob => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${displayName.replace(/[^a-zA-Z0-9]/g, '_')}_${this.currentGender}_bracket.png`;
                a.click();
                URL.revokeObjectURL(url);
                showToast('Bracket downloaded!', 'success');
            }, 'image/png');
        } catch (e) {
            console.error('Screenshot error:', e);
            showToast('Error generating screenshot', 'error');
        } finally {
            // Remove temporary elements, restore wrapper, redraw and rescale
            document.querySelectorAll('.screenshot-title').forEach(el => el.remove());
            bracketArea.style.height = wrapperOldHeight;
            bracketArea.style.overflow = wrapperOldOverflow;
            bracketArea.style.width = wrapperOldWidth;
            bracketArea.style.minWidth = wrapperOldMinWidth;
            bracketArea.style.maxWidth = wrapperOldMaxWidth;
            this._resetBracketScale();
            this.drawBracketSVG();
            this._scaleBracketToFit();
        }
    },

    /** Copy or share a direct link to the user's bracket (uses Web Share API if available) */
    async shareLink() {
        const uid = this.currentUser?.uid;
        if (!uid) {
            showToast('Sign in to share your bracket link', 'error');
            return;
        }
        const url = `${window.location.origin}${window.location.pathname}#bracket/${this.currentGender}/${uid}`;
        try {
            if (navigator.share) {
                await navigator.share({ title: 'My AJKC Anarchy Bracket', url });
            } else {
                await navigator.clipboard.writeText(url);
                showToast('Bracket link copied to clipboard!', 'success');
            }
        } catch (e) {
            // Fallback if share/clipboard fails
            try {
                await navigator.clipboard.writeText(url);
                showToast('Bracket link copied to clipboard!', 'success');
            } catch {
                showToast('Could not copy link', 'error');
            }
        }
    },

    /** Check URL hash for #bracket/{gender}/{uid} share links and load that bracket */
    _checkShareLink() {
        const hash = window.location.hash;
        const match = hash.match(/^#bracket\/(men|women)\/(.+)$/);
        if (match) {
            const [, gender, uid] = match;
            window.location.hash = '';
            // Delay to let the app initialize, then load directly without intermediate render
            setTimeout(async () => {
                document.getElementById('landingPage').style.display = 'none';
                document.getElementById('mainApp').style.display = 'block';
                this.currentView = 'bracket';
                this.currentGender = gender;
                this.players = gender === 'men' ? this.menPlayers : this.womenPlayers;
                document.body.className = gender === 'women' ? 'women' : '';
                document.getElementById('menBtn')?.classList.toggle('active', gender === 'men');
                document.getElementById('womenBtn')?.classList.toggle('active', gender === 'women');
                await this.checkLockStatus();
                await this.loadSpecificBracket(uid, gender);
            }, 300);
        }
    },

    /** After saving a bracket, prompt anonymous users to upgrade their account */
    async promptAccountUpgrade() {
        if (!this.currentUser || !this.currentUser.isAnonymous) return;
        const content = document.getElementById('signInContent');
        content.innerHTML = `
            <div style="padding:20px;">
                <p style="color:var(--kendo-gold);font-family:'Bebas Neue',sans-serif;font-size:1.3em;letter-spacing:2px;text-align:center;margin-bottom:8px;">
                    BRACKET SAVED!
                </p>
                <p style="color:rgba(255,255,255,0.5);font-size:0.85em;margin-bottom:20px;text-align:center;">
                    Sign in to keep your bracket safe across devices. Without an account, your picks may be lost if you clear your browser data.
                </p>
                <div style="display:flex;flex-direction:column;gap:12px;">
                    <button class="bracket-action-btn bracket-action-gold" onclick="app.upgradeWithGoogle()" style="width:100%;justify-content:center;">
                        SIGN IN WITH GOOGLE
                    </button>
                    <div style="text-align:center;color:rgba(255,255,255,0.3);font-size:0.8em;">or</div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        <input type="email" id="emailSignInInput" class="submit-name-input" placeholder="Enter your email" style="flex:1;min-width:180px;" />
                        <button class="bracket-action-btn" onclick="app.sendEmailLink()" style="white-space:nowrap;">SEND LINK</button>
                    </div>
                    <button class="bracket-action-btn" onclick="app.closeSignInModal()" style="width:100%;text-align:center;opacity:0.5;">
                        MAYBE LATER
                    </button>
                </div>
            </div>`;
        document.getElementById('signInModal').style.display = 'block';
        lockBodyScroll();
    },

    // ── Gender switching ────────────────────────────────────────

    /** Switch between men's and women's brackets. Resets picks, reloads user bracket, updates colors */
    async switchGender(gender) {
        this.currentGender = gender;
        this.players = gender === 'men' ? this.menPlayers : this.womenPlayers;
        this.bracket = {};
        this._pickHistory = [];
        this.viewingOtherBracket = false;
        this.gameState = 'picking';
        this.gameRound = 0;
        this.gameMatch = 0;
        this._oddsCache = null;
        this.showOdds = false;
        UI.showBackToMine(false);

        // Clear technique for fresh load per gender
        const techEl = document.getElementById('userTechnique');
        if (techEl) techEl.value = '';

        document.body.className = gender === 'women' ? 'women' : '';
        document.getElementById('menBtn')?.classList.toggle('active', gender === 'men');
        document.getElementById('womenBtn')?.classList.toggle('active', gender === 'women');

        // Clear stale content immediately so old bracket doesn't flash in new colors
        const gc = document.getElementById('gameContainer');
        if (gc) gc.innerHTML = '';

        await this.checkLockStatus();
        await this.loadActualResults();

        if (this.adminMode) {
            // Reload actual results for admin editing
            try {
                const doc = await db.collection('actualResults-' + this.currentGender).doc('current').get();
                this.bracket = doc.exists ? (doc.data().predictions || {}) : {};
            } catch { this.bracket = {}; }
            this.render();
        } else {
            await this.loadUserBracket();
        }
        this.updateLeaderboard();
        this.updateBracketCount();
    },

    // ── Lock status ─────────────────────────────────────────────

    /** Check Firestore + tournament date to determine if submissions are locked */
    async checkLockStatus() {
        try {
            const doc = await db.collection('settings').doc('tournament').get();
            const manualLock = doc.exists ? (doc.data().locked || false) : false;
            const autoLock = new Date() >= this.tournamentDate;
            this.isLocked = manualLock || autoLock;
            document.getElementById('lockedNotice').style.display = this.isLocked ? 'block' : 'none';
        } catch (e) { console.error('Error checking lock status:', e); }
    },

    /** Admin: toggle submission lock on/off for both brackets */
    async toggleLock() {
        try {
            this.isLocked = !this.isLocked;
            await db.collection('settings').doc('tournament').set({
                locked: this.isLocked,
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });
            document.getElementById('lockBtn').textContent =
                this.isLocked ? '🔓 Unlock Submissions' : '🔒 Lock Submissions';
            document.getElementById('lockedNotice').style.display =
                this.isLocked ? 'block' : 'none';
            showToast(this.isLocked
                ? 'Both brackets locked!'
                : 'Both brackets unlocked!', 'success');
        } catch (e) { showToast('Error toggling lock: ' + e.message, 'error'); }
    },

    // ── Bracket persistence ─────────────────────────────────────

    /**
     * Load the current user's saved bracket from Firestore.
     * Restores picks, sets gameState, and renders.
     * Uses _navGen guard to prevent stale renders.
     */
    async loadUserBracket() {
        if (!this.currentUser) return;
        const navGen = this._navGen;
        try {
            const doc = await db.collection('brackets-' + this.currentGender)
                .doc(this.currentUser.uid).get();
            if (doc.exists) {
                const data = doc.data();
                this.userBracketData = data.predictions || {};
                this.bracket = { ...this.userBracketData };
                this._submissionDate = data.timestamp ? data.timestamp.toDate() : null;
                if (data.displayName) {
                    document.getElementById('userName').value = data.displayName;
                }
                const locEl = document.getElementById('userLocation');
                if (locEl && data.location) {
                    locEl.value = data.location;
                }
                const techEl = document.getElementById('userTechnique');
                if (techEl && data.finalTechnique) {
                    techEl.value = data.finalTechnique;
                }
                const scoreEl = document.getElementById('userFinalScore');
                if (scoreEl && data.finalScore) {
                    scoreEl.value = data.finalScore;
                }
                if (this.isBracketComplete()) {
                    this.gameState = 'bracket-summary';
                } else if (this.hasAnyPicks()) {
                    this.gameState = 'picking';
                    this.findFirstIncompleteMatch();
                } else {
                    this.gameState = 'picking';
                    this.gameRound = 0;
                    this.gameMatch = 0;
                }
            } else {
                this.userBracketData = null;
                this.bracket = {};
                this.gameState = 'picking';
                this.gameRound = 0;
                this.gameMatch = 0;
                // Clear technique when no bracket exists for this gender
                const techEl = document.getElementById('userTechnique');
                if (techEl) techEl.value = '';
            }
            this.viewingOtherBracket = false;
            UI.showBackToMine(false);
            // Only render if the main app is visible and user hasn't navigated away
            if (navGen === this._navGen && document.getElementById('mainApp').style.display !== 'none') {
                this.render();
            }
        } catch (e) { console.error('Error loading user bracket:', e); }
    },

    /** Check if the user has made any picks in any round */
    hasAnyPicks() {
        for (let r = 0; r < 6; r++) {
            if (this.bracket[r] && Object.keys(this.bracket[r]).length > 0) return true;
        }
        return false;
    },

    /** Save the current bracket to Firestore with user's name, location, and ippon prediction */
    saveBracket() {
        if (!this.currentUser) {
            showToast('Something went wrong — please refresh.', 'error');
            return;
        }
        const nameInput = document.getElementById('submitName') || document.getElementById('userName');
        const displayName = nameInput ? nameInput.value.trim() : '';
        const locationInput = document.getElementById('submitLocation') || document.getElementById('userLocation');
        const location = locationInput ? locationInput.value.trim() : '';
        const techniqueInput = document.getElementById('submitTechnique') || document.getElementById('userTechnique');
        const finalTechnique = techniqueInput ? techniqueInput.value : '';
        const scoreInput = document.getElementById('submitFinalScore') || document.getElementById('userFinalScore');
        const finalScore = scoreInput ? scoreInput.value : '';
        if (!displayName) {
            showToast('Please enter your name!', 'error');
            if (nameInput) nameInput.focus();
            return;
        }
        if (this.isLocked && !this.adminMode) {
            showToast('Tournament is locked!', 'error');
            return;
        }
        if (this.viewingOtherBracket) {
            showToast("You're viewing someone else's bracket.", 'error');
            return;
        }

        db.collection('brackets-' + this.currentGender).doc(this.currentUser.uid).set({
            displayName,
            location,
            finalTechnique,
            finalScore,
            predictions: this.bracket,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        }).then(() => {
            this.userBracketData = { ...this.bracket };
            showToast(`Bracket saved for ${displayName}!`, 'success');
            this.updateBracketCount();
            this.promptAccountUpgrade();
        }).catch(e => showToast('Error saving bracket: ' + e.message, 'error'));
    },

    // ── Admin mode ──────────────────────────────────────────────

    /** Toggle admin mode on/off. Requires Google sign-in and admin whitelist check */
    async toggleAdminMode() {
        if (!this.adminMode) {
            if (!this.currentUser || this.currentUser.isAnonymous || !this.isAdmin) {
                const ok = await this.signInWithGoogle();
                if (!ok) return;

                // Explicitly check admin status after sign-in
                const user = auth.currentUser;
                if (!user || !user.email) {
                    showToast('Sign-in failed.', 'error');
                    return;
                }
                try {
                    const adminDoc = await db.collection('admins').doc(user.email).get();
                    this.isAdmin = adminDoc.exists;
                    this.currentUser = user;
                } catch {
                    this.isAdmin = false;
                }
                if (!this.isAdmin) {
                    showToast('Not authorised as admin.', 'error');
                    return;
                }
            }
            this.adminMode = true;
            this.viewingOtherBracket = false;
            UI.showBackToMine(false);
            document.getElementById('lockBtn').textContent =
                this.isLocked ? '🔓 Unlock Submissions' : '🔒 Lock Submissions';
            try {
                const doc = await db.collection('actualResults-' + this.currentGender).doc('current').get();
                this.bracket = doc.exists ? (doc.data().predictions || {}) : {};
            } catch { this.bracket = {}; }
            try {
                const techDoc = await db.collection('settings').doc('actualTechnique-' + this.currentGender).get();
                if (techDoc.exists) {
                    const adminTech = document.getElementById('adminTechnique');
                    if (adminTech) adminTech.value = techDoc.data().technique || '';
                    const adminScore = document.getElementById('adminFinalScore');
                    if (adminScore) adminScore.value = techDoc.data().score || '';
                }
            } catch { /* ignore */ }
        } else {
            this.adminMode = false;
            if (this.userBracketData) {
                this.bracket = { ...this.userBracketData };
                this.gameState = this.isBracketComplete() ? 'bracket-summary' : 'picking';
                if (this.gameState === 'picking') this.findFirstIncompleteMatch();
            } else {
                this.bracket = {};
                this.gameState = 'picking';
                this.gameRound = 0;
                this.gameMatch = 0;
            }
        }

        const indicator = document.getElementById('modeIndicator');
        const modeText = document.getElementById('modeText');
        if (this.adminMode) {
            modeText.textContent = '⚙️ ADMIN MODE — Enter Actual Results';
            indicator.style.display = 'flex';
            indicator.style.justifyContent = 'center';
            indicator.style.alignItems = 'center';
            const genderSelect = document.getElementById('adminGenderSelect');
            if (genderSelect) genderSelect.value = this.currentGender;
        } else {
            indicator.style.display = 'none';
        }
        this.render();
    },

    /** Admin: delete all actual results for the current gender (requires typing DELETE) */
    async clearActualResults() {
        const gender = this.currentGender;
        const label = gender === 'men' ? "mens" : "womens";
        const input = prompt(`This will clear actual results for the ${label} bracket.\n\nType DELETE to confirm:`);
        if (input !== 'DELETE') {
            if (input !== null) showToast('Cancelled — you must type DELETE exactly.', 'error');
            return;
        }
        try {
            await db.collection('actualResults-' + gender).doc('current').delete();
            this.actualResults = null;
            this.bracket = {};
            this.render();
            showToast(`Actual ${label} results cleared!`, 'success');
        } catch (e) { showToast('Error: ' + e.message, 'error'); }
    },

    /** Admin: switch gender while in admin mode and reload results */
    async switchAdminGender(gender) {
        this.currentGender = gender;
        this.players = gender === 'men' ? this.menPlayers : this.womenPlayers;
        document.body.className = gender === 'women' ? 'women' : '';
        try {
            const doc = await db.collection('actualResults-' + gender).doc('current').get();
            this.bracket = doc.exists ? (doc.data().predictions || {}) : {};
        } catch { this.bracket = {}; }
        await this.loadActualResults();
        this.render();
    },

    /** Admin: delete all user bracket submissions for current gender (requires typing DELETE) */
    async clearUserData() {
        const gender = this.currentGender;
        const label = gender === 'men' ? "mens" : "womens";
        const input = prompt(`This will delete ALL user bracket submissions for the ${label} bracket.\n\nType DELETE to confirm:`);
        if (input !== 'DELETE') {
            if (input !== null) showToast('Cancelled — you must type DELETE exactly.', 'error');
            return;
        }
        try {
            const snap = await db.collection('brackets-' + gender).get();
            const promises = [];
            snap.forEach(doc => promises.push(doc.ref.delete()));
            await Promise.all(promises);
            this.userBracketData = null;
            this.updateLeaderboard();
            this.updateBracketCount();
            showToast(`All ${label} user brackets cleared!`, 'success');
        } catch (e) { showToast('Error: ' + e.message, 'error'); }
    },

    /** Admin: delete everything (brackets + results) for current gender */
    async clearAll() {
        const input = prompt('This will delete ALL data for this bracket (users + results).\n\nType DELETE to confirm:');
        if (input !== 'DELETE') {
            if (input !== null) showToast('Cancelled — you must type DELETE exactly.', 'error');
            return;
        }
        try {
            const snap = await db.collection('brackets-' + this.currentGender).get();
            const promises = [];
            snap.forEach(doc => promises.push(doc.ref.delete()));
            promises.push(db.collection('actualResults-' + this.currentGender).doc('current').delete());
            await Promise.all(promises);

            this.bracket = {};
            this.userBracketData = null;
            this.actualResults = null;
            this.adminMode = false;
            this.gameState = 'picking';
            this.gameRound = 0;
            this.gameMatch = 0;
            document.getElementById('modeIndicator').style.display = 'none';
            this.render();
            this.updateLeaderboard();
            this.updateBracketCount();
            showToast('All data cleared!', 'success');
        } catch (e) { showToast('Error: ' + e.message, 'error'); }
    },

    // ── Game flow helpers ───────────────────────────────────────

    /** Check if all matches in a round have been picked */
    isRoundComplete(round) {
        const count = 32 / Math.pow(2, round);
        for (let m = 0; m < count; m++) {
            if (!this.bracket[round]?.[m]) return false;
        }
        return true;
    },

    /** Check if all 63 matches across all 6 rounds have been picked */
    isBracketComplete() {
        for (let r = 0; r < 6; r++) {
            if (!this.isRoundComplete(r)) return false;
        }
        return true;
    },

    /** Find the first unpicked match and set gameRound/gameMatch to it */
    findFirstIncompleteMatch() {
        for (let r = 0; r < 6; r++) {
            if (!this.isRoundComplete(r)) {
                const count = 32 / Math.pow(2, r);
                for (let m = 0; m < count; m++) {
                    if (!this.bracket[r]?.[m]) {
                        this.gameRound = r;
                        this.gameMatch = m;
                        return;
                    }
                }
            }
        }
        this.gameState = 'bracket-summary';
    },

    /** When a pick changes, recursively clear all downstream picks that depended on the old winner */
    invalidateDownstream(round, matchIndex) {
        const nextRound = round + 1;
        if (nextRound > 5) return;
        const nextMatch = Math.floor(matchIndex / 2);
        if (this.bracket[nextRound]?.[nextMatch] !== undefined) {
            delete this.bracket[nextRound][nextMatch];
            this.invalidateDownstream(nextRound, nextMatch);
        }
    },

    // ── Card flow interaction ───────────────────────────────────

    /** Handle a player pick: record to undo stack, update bracket, invalidate downstream, auto-advance */
    pickWinner(round, matchIndex, playerId) {
        clearTimeout(this._advanceTimeout);
        const oldPick = this.bracket[round]?.[matchIndex];

        // Haptic feedback on mobile
        if (navigator.vibrate) navigator.vibrate(10);

        // Record undo history
        this._pickHistory.push({
            round, matchIndex,
            oldPick: oldPick !== undefined ? oldPick : null,
            gameRound: this.gameRound,
            gameMatch: this.gameMatch
        });

        if (!this.bracket[round]) this.bracket[round] = {};
        this.bracket[round][matchIndex] = playerId;

        if (oldPick !== undefined && oldPick !== playerId) {
            this.invalidateDownstream(round, matchIndex);
        }

        // Visually highlight picked card without full re-render
        document.querySelectorAll('.player-card').forEach(c => c.classList.remove('picked'));
        // Find the card by matching the onclick attribute containing the playerId
        document.querySelectorAll('.player-card').forEach(c => {
            const attr = c.getAttribute('onclick') || '';
            if (attr.includes(`, ${playerId})`)) c.classList.add('picked');
        });
        const nextBtn = document.querySelector('.game-nav button:last-child');
        if (nextBtn) nextBtn.disabled = false;

        // Confetti on champion pick
        if (round === 5) {
            this.fireConfetti();
            return; // Don't auto-advance — let user press Next
        }

        this._advanceTimeout = setTimeout(() => this.nextMatch(), 400);
    },

    /** Spawn confetti particles when the user picks their champion */
    fireConfetti() {
        const container = document.getElementById('gameContainer');
        const confettiEl = document.createElement('div');
        confettiEl.className = 'confetti-container';
        const colors = ['#f1c40f', '#e74c3c', '#d4a843', '#48bb78', '#cc3333', '#fff'];
        for (let i = 0; i < 60; i++) {
            const piece = document.createElement('div');
            piece.className = 'confetti-piece';
            piece.style.left = Math.random() * 100 + '%';
            piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
            piece.style.animationDelay = Math.random() * 0.5 + 's';
            piece.style.animationDuration = (1.5 + Math.random() * 1.5) + 's';
            confettiEl.appendChild(piece);
        }
        container.appendChild(confettiEl);
        setTimeout(() => confettiEl.remove(), 3500);
    },

    /** Advance to the next match, or transition to round-summary/post-finals if round is complete */
    nextMatch() {
        clearTimeout(this._advanceTimeout);
        const matchCount = 32 / Math.pow(2, this.gameRound);

        if (this.gameMatch < matchCount - 1) {
            this.gameMatch++;
        } else if (this.isRoundComplete(this.gameRound)) {
            if (this.gameRound < 5) {
                this.gameState = 'round-summary';
            } else {
                // Finals complete — enter post-finals transition flow
                if (this.currentUser && !this.currentUser.isAnonymous) {
                    this.gameState = 'post-finals-submit';
                } else {
                    this.gameState = 'post-finals-login';
                }
            }
        } else {
            // Round not complete (cascade cleared some picks) — jump to first gap
            for (let m = 0; m < matchCount; m++) {
                if (!this.bracket[this.gameRound]?.[m]) {
                    this.gameMatch = m;
                    break;
                }
            }
        }
        this.render();
    },

    /** Go back to the previous match (or previous round's last match) */
    prevMatch() {
        clearTimeout(this._advanceTimeout);

        if (this.gameState === 'round-summary') {
            this.gameState = 'picking';
            this.gameMatch = 32 / Math.pow(2, this.gameRound) - 1;
            this.render();
            return;
        }

        if (this.gameMatch > 0) {
            this.gameMatch--;
        } else if (this.gameRound > 0) {
            this.gameRound--;
            this.gameMatch = 32 / Math.pow(2, this.gameRound) - 1;
        }
        this.render();
    },

    /** Pop the last pick from history, restore old state, and re-render */
    undoLastPick() {
        if (!this._pickHistory.length) return;
        clearTimeout(this._advanceTimeout);
        const last = this._pickHistory.pop();
        // Restore the old pick (or remove it)
        if (last.oldPick === null) {
            delete this.bracket[last.round]?.[last.matchIndex];
        } else {
            if (!this.bracket[last.round]) this.bracket[last.round] = {};
            this.bracket[last.round][last.matchIndex] = last.oldPick;
        }
        // Invalidate downstream from this change
        this.invalidateDownstream(last.round, last.matchIndex);
        // Navigate back to where the pick was made
        this.gameRound = last.gameRound;
        this.gameMatch = last.gameMatch;
        this.gameState = 'picking';
        this.render();
    },

    /** Show round splash screen then advance to next round's first match */
    advanceToNextRound() {
        const nextRound = this.gameRound + 1;
        // Show dramatic splash before entering next round
        this.showRoundSplash(nextRound, () => {
            this.gameRound = nextRound;
            this.gameMatch = 0;
            this.gameState = 'picking';
            this.render();
        });
    },

    /** Display a dramatic full-screen splash with round name (Japanese + English) */
    showRoundSplash(roundIndex, callback) {
        const container = document.getElementById('gameContainer');
        const name = ROUND_NAMES[roundIndex];
        const nameJp = ROUND_NAMES_JP[roundIndex];
        const isFinals = roundIndex === 5;

        container.innerHTML = `
            <div class="round-splash ${isFinals ? 'round-splash-finals' : ''}">
                <div class="splash-jp">${UI.escapeHtml(nameJp)}</div>
                <div class="splash-name">${UI.escapeHtml(name)}</div>
                <div class="splash-line"></div>
            </div>`;

        setTimeout(callback, 1800);
    },

    // ── Post-finals transition screens ───────────────────────────

    /** Post-finals: show Google sign-in screen for anonymous users */
    renderPostFinalsLogin() {
        const container = document.getElementById('gameContainer');
        container.innerHTML = `
            <div class="pf-screen">
                <div class="pf-icon">🎉</div>
                <h1 class="pf-title">BRACKET COMPLETE!</h1>
                <p class="pf-subtitle">Sign in to save your bracket and compete on the leaderboard.</p>
                <div class="pf-login-options">
                    <button class="pf-btn pf-btn-google" onclick="app._postFinalsGoogleLogin()">
                        <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                        SIGN IN WITH GOOGLE
                    </button>
                    <button class="pf-btn pf-btn-skip" onclick="app._postFinalsSkipLogin()">CONTINUE WITHOUT SIGNING IN</button>
                </div>
            </div>`;
    },

    async _postFinalsGoogleLogin() {
        const ok = await this.signInWithGoogle();
        if (ok) {
            this.gameState = 'post-finals-submit';
            this.render();
        }
    },

    _postFinalsSkipLogin() {
        this.gameState = 'post-finals-submit';
        this.render();
    },

    /** Post-finals: show name/country/ippon submission form */
    renderPostFinalsSubmit() {
        const container = document.getElementById('gameContainer');
        const savedName = this.currentUser?.displayName || document.getElementById('userName')?.value || '';
        const savedLocation = document.getElementById('userLocation')?.value || '';
        const savedTechnique = document.getElementById('userTechnique')?.value || '';

        container.innerHTML = `
            <div class="pf-screen">
                <div class="pf-icon">📋</div>
                <h1 class="pf-title">SUBMIT YOUR BRACKET</h1>
                <p class="pf-subtitle">Almost there! Fill in your details to lock in your predictions.</p>
                <div class="pf-form">
                    <div class="pf-field">
                        <label class="pf-label" for="pfName">Name / お名前</label>
                        <input type="text" id="pfName" class="pf-input" placeholder="Enter your name" maxlength="30" value="${UI.escapeHtml(savedName)}" />
                    </div>
                    <div class="pf-field">
                        <label class="pf-label" for="pfLocation">Country / 出身地 <span style="opacity:0.5">(optional)</span></label>
                        <select id="pfLocation" class="pf-input"><option value="">Select country...</option></select>
                    </div>
                    <div class="pf-field">
                        <label class="pf-label" for="pfTechnique">Final winning ippon <span style="opacity:0.5">(bonus +5 pts)</span></label>
                        <select id="pfTechnique" class="pf-input">
                            <option value="">Select ippon...</option>
                            <option value="men"${savedTechnique === 'men' ? ' selected' : ''}>Men (メ)</option>
                            <option value="kote"${savedTechnique === 'kote' ? ' selected' : ''}>Kote (コ)</option>
                            <option value="dou"${savedTechnique === 'dou' ? ' selected' : ''}>Dou (ド)</option>
                            <option value="tsuki"${savedTechnique === 'tsuki' ? ' selected' : ''}>Tsuki (ツ)</option>
                            <option value="hansoku"${savedTechnique === 'hansoku' ? ' selected' : ''}>Hansoku (ハンソク)</option>
                        </select>
                    </div>
                    <button class="pf-btn pf-btn-submit" onclick="app._postFinalsSubmit()">SUBMIT BRACKET</button>
                </div>
            </div>`;

        // Populate country dropdown
        const sel = document.getElementById('pfLocation');
        const countries = [
            'Argentina', 'Australia', 'Austria', 'Belgium', 'Brazil',
            'Canada', 'Chile', 'China', 'Colombia', 'Croatia',
            'Czech Republic', 'Denmark', 'Finland', 'France', 'Germany',
            'Hong Kong', 'Hungary', 'Iceland', 'India', 'Indonesia',
            'Ireland', 'Israel', 'Italy', 'Japan', 'Luxembourg',
            'Malaysia', 'Mexico', 'Netherlands', 'New Zealand', 'Norway',
            'Peru', 'Philippines', 'Poland', 'Portugal', 'Romania',
            'Russia', 'Scotland', 'Serbia', 'Singapore', 'South Africa',
            'South Korea', 'Spain', 'Sweden', 'Switzerland', 'Taiwan',
            'Thailand', 'United Kingdom', 'United States', 'Other'
        ];
        countries.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c;
            opt.textContent = c;
            if (c === savedLocation) opt.selected = true;
            sel.appendChild(opt);
        });
    },

    /** Post-finals: validate form inputs and save bracket to Firestore */
    _postFinalsSubmit() {
        if (!this.currentUser) {
            showToast('Something went wrong — please refresh.', 'error');
            return;
        }
        const displayName = document.getElementById('pfName')?.value.trim() || '';
        const location = document.getElementById('pfLocation')?.value.trim() || '';
        const finalTechnique = document.getElementById('pfTechnique')?.value || '';
        if (!displayName) {
            showToast('Please enter your name!', 'error');
            document.getElementById('pfName')?.focus();
            return;
        }
        if (this.isLocked && !this.adminMode) {
            showToast('Tournament is locked!', 'error');
            return;
        }

        // Save to hidden inputs so bracket summary has them
        const userNameEl = document.getElementById('userName');
        if (userNameEl) userNameEl.value = displayName;
        const userLocEl = document.getElementById('userLocation');
        if (userLocEl) userLocEl.value = location;
        const userTechEl = document.getElementById('userTechnique');
        if (userTechEl) userTechEl.value = finalTechnique;

        db.collection('brackets-' + this.currentGender).doc(this.currentUser.uid).set({
            displayName,
            location,
            finalTechnique,
            predictions: this.bracket,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        }).then(() => {
            this.userBracketData = { ...this.bracket };
            this.updateBracketCount();
            this.promptAccountUpgrade();
            this.gameState = 'post-finals-thanks';
            this.render();
        }).catch(e => showToast('Error saving bracket: ' + e.message, 'error'));
    },

    /** Post-finals: show thank-you screen with champion pick */
    renderPostFinalsThanks() {
        const container = document.getElementById('gameContainer');
        const champion = this._getChampionName();
        container.innerHTML = `
            <div class="pf-screen pf-thanks">
                <div class="pf-icon">🏆</div>
                <h1 class="pf-title">THANKS FOR PLAYING!</h1>
                <p class="pf-subtitle">Your bracket has been submitted. ${champion ? 'Your champion pick: <strong>' + UI.escapeHtml(champion) + '</strong>' : ''}</p>
                <p class="pf-subtitle" style="margin-top:8px;opacity:0.5;">Good luck and may the best bracket win!</p>
                <div class="pf-thanks-btns">
                    <button class="pf-btn pf-btn-primary" onclick="app.showBracketSummary()">VIEW MY BRACKET</button>
                    <button class="pf-btn pf-btn-gold" onclick="app.showDonateModal()">SUPPORT AJKCANARCHY</button>
                </div>
            </div>`;
    },

    /** Get the name of the user's predicted champion (round 5, match 0 winner) */
    _getChampionName() {
        const winnerId = this.bracket[5]?.[0];
        if (!winnerId) return null;
        const players = this.currentGender === 'men' ? this.menPlayers : this.womenPlayers;
        const p = players.find(pl => pl.id === winnerId);
        return p ? p.name : null;
    },

    showBracketSummary() {
        this.gameState = 'bracket-summary';
        this.render();
    },

    startEditing() {
        this._pickHistory = [];
        this.gameState = 'picking';
        this.gameRound = 0;
        this.gameMatch = 0;
        this.render();
    },

    resumePicking() {
        this._pickHistory = [];
        this.gameState = 'picking';
        this.findFirstIncompleteMatch();
        this.render();
    },

    jumpToRound(round) {
        clearTimeout(this._advanceTimeout);
        this.gameState = 'picking';
        this.gameRound = round;
        this.gameMatch = 0;
        this.render();
    },

    // ── Admin bracket interaction ───────────────────────────────

    /** Admin: record a match winner in the actual results bracket */
    selectWinner(round, matchup, playerId) {
        if (!this.bracket[round]) this.bracket[round] = {};
        this.bracket[round][matchup] = playerId;
        this.renderAdminBracket();
    },

    /** Admin: save current bracket state as official tournament results */
    async saveAdminResults() {
        try {
            await db.collection('actualResults-' + this.currentGender).doc('current').set({
                predictions: this.bracket,
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });
            this.actualResults = { ...this.bracket };
            this.updateLeaderboard();
            showToast('Results saved!', 'success');
        } catch (e) {
            showToast('Error saving results: ' + e.message, 'error');
        }
    },

    /** Admin: save the winning ippon technique for the finals */
    async saveActualTechnique() {
        const technique = document.getElementById('adminTechnique')?.value || '';
        const score = document.getElementById('adminFinalScore')?.value || '';
        try {
            await db.collection('settings').doc('actualTechnique-' + this.currentGender).set({
                technique,
                score,
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });
            showToast('Final technique saved!', 'success');
        } catch (e) {
            showToast('Error saving: ' + e.message, 'error');
        }
    },

    // ── Rendering dispatch ──────────────────────────────────────

    /**
     * Get the two players for each match in a given round.
     * Round 0: pairs from the seeded player list.
     * Rounds 1-5: winners from the previous round's picks.
     */
    getRoundMatches(round) {
        const matchCount = 32 / Math.pow(2, round);
        const matches = [];
        for (let i = 0; i < matchCount; i++) {
            if (round === 0) {
                matches.push({
                    player1: this.players[i * 2],
                    player2: this.players[i * 2 + 1]
                });
            } else {
                const winner1 = this.bracket[round - 1]?.[i * 2];
                const winner2 = this.bracket[round - 1]?.[i * 2 + 1];
                matches.push({
                    player1: winner1 ? this.players.find(p => p.id === winner1) : null,
                    player2: winner2 ? this.players.find(p => p.id === winner2) : null
                });
            }
        }
        return matches;
    },

    /**
     * Main render dispatcher. Routes to the correct page/view based on
     * currentView and gameState. Called after every state change.
     */
    render() {
        const gameContainer = document.getElementById('gameContainer');
        const bracketContainer = document.getElementById('bracketContainer');

        if (this.adminMode) {
            gameContainer.style.display = 'none';
            bracketContainer.style.display = 'block';
            this.renderAdminBracket();
            return;
        }

        bracketContainer.style.display = 'none';
        gameContainer.style.display = 'block';

        // Non-bracket views
        if (this.currentView === 'leaderboard') { this.renderLeaderboardPage(); return; }
        if (this.currentView === 'stats') { this.renderStatsPage(); return; }
        if (this.currentView === 'allBrackets') { this.renderAllBracketsPage(); return; }
        if (this.currentView === 'legal') { this.renderLegalPage(); return; }
        if (this.currentView === 'donate') { this.renderDonatePage(); return; }
        if (this.currentView === 'faq') { this.renderFaqPage(); return; }
        if (this.currentView === 'liveBracket') { this.renderLiveBracketPage(); return; }

        // Set round intensity on body for progressive atmosphere
        if (this.gameState === 'picking') {
            document.body.dataset.intensity = this.gameRound;
        } else {
            delete document.body.dataset.intensity;
        }

        switch (this.gameState) {
            case 'picking':            this.renderCardView(); break;
            case 'round-summary':      this.renderRoundSummaryView(); break;
            case 'post-finals-login':  this.renderPostFinalsLogin(); break;
            case 'post-finals-submit': this.renderPostFinalsSubmit(); break;
            case 'post-finals-thanks': this.renderPostFinalsThanks(); break;
            default:                   this.renderBracketSummaryView(); break;
        }
    },

    /** Render the card-based matchup picking view for the current round/match */
    renderCardView() {
        const matches = this.getRoundMatches(this.gameRound);
        const match = matches[this.gameMatch];
        const totalMatches = 32 / Math.pow(2, this.gameRound);
        const currentPick = this.bracket[this.gameRound]?.[this.gameMatch];

        // Build odds data if toggle is on
        let odds = null;
        if (this.showOdds && this._oddsCache) {
            const r = this.gameRound;
            const m = this.gameMatch;
            const p1Count = this._oddsCache[r]?.[m]?.[match.player1?.id] || 0;
            const p2Count = this._oddsCache[r]?.[m]?.[match.player2?.id] || 0;
            const total = p1Count + p2Count;
            const p1Pct = total > 0 ? Math.round((p1Count / total) * 100) : 0;
            odds = {
                p1Pct,
                p2Pct: total > 0 ? 100 - p1Pct : 0,
                total
            };
        }

        document.getElementById('gameContainer').innerHTML = UI.renderCardMatchup({
            player1: match.player1,
            player2: match.player2,
            roundName: ROUND_NAMES[this.gameRound],
            roundNameJp: ROUND_NAMES_JP[this.gameRound],
            matchIndex: this.gameMatch,
            totalMatches,
            roundIndex: this.gameRound,
            currentPick,
            isFirstMatch: this.gameRound === 0 && this.gameMatch === 0,
            odds,
            showOdds: this.showOdds,
            isFinals: this.gameRound === 5,
            pickHistory: this._pickHistory
        });
    },

    /** Render the round completion screen showing all winners advancing */
    renderRoundSummaryView() {
        const matches = this.getRoundMatches(this.gameRound);
        const picks = [];
        matches.forEach((match, mi) => {
            const winnerId = this.bracket[this.gameRound]?.[mi];
            if (winnerId && match.player1 && match.player2) {
                const winner = winnerId === match.player1.id ? match.player1 : match.player2;
                const loser = winnerId === match.player1.id ? match.player2 : match.player1;
                picks.push({ winner: winner.name, loser: loser.name });
            }
        });

        document.getElementById('gameContainer').innerHTML = UI.renderRoundSummary({
            roundName: ROUND_NAMES[this.gameRound],
            roundNameJp: ROUND_NAMES_JP[this.gameRound],
            nextRoundName: this.gameRound < 5 ? ROUND_NAMES[this.gameRound + 1] : null,
            nextRoundNameJp: this.gameRound < 5 ? ROUND_NAMES_JP[this.gameRound + 1] : null,
            picks,
            isFinalRound: this.gameRound >= 5
        });
    },

    /** Render the full bracket summary page with stats bar, bracket tree, and action buttons */
    renderBracketSummaryView() {
        const rounds = [];
        for (let r = 0; r < 6; r++) {
            const matches = this.getRoundMatches(r);
            const picks = [];
            matches.forEach((match, mi) => {
                const winnerId = this.bracket[r]?.[mi];
                if (winnerId && match.player1 && match.player2) {
                    const winner = winnerId === match.player1.id ? match.player1 : match.player2;
                    const loser = winnerId === match.player1.id ? match.player2 : match.player1;
                    let matchResult;
                    if (this.actualResults?.[r]?.[mi] !== undefined) {
                        matchResult = this.actualResults[r][mi] === winnerId;
                    }
                    picks.push({ winner: winner.name, loser: loser.name, matchResult });
                }
            });
            if (picks.length > 0) {
                rounds.push({ name: ROUND_NAMES[r], picks });
            }
        }

        const championId = this.bracket[5]?.[0];
        const champion = championId ? this.players.find(p => p.id === championId)?.name : null;

        document.getElementById('gameContainer').innerHTML = UI.renderBracketSummary({
            rounds,
            champion,
            isReadonly: this.viewingOtherBracket,
            isComplete: this.isBracketComplete(),
            actualResults: this.actualResults,
            viewingName: this.viewingOtherBracket ? this._viewingBracketName : null
        });

        const area = document.getElementById('bracketVisualArea');
        if (area) {
            area.innerHTML = this.buildBracketHTML(false);
            this.scheduleBracketRedraw();
        }

        // Populate country dropdown
        this._populateCountryDropdown();

        // Calculate bracket similarity asynchronously
        this._calcAndShowSimilarity();
    },

    async _calcAndShowSimilarity() {
        const el = document.getElementById('bracketSimilarity');
        if (!el) return;
        try {
            if (!this._oddsCache) await this._loadOdds();
            if (!this._oddsCache) return;
            const sim = this._calcBracketSimilarity(this.bracket, this._oddsCache);
            if (sim !== null) el.textContent = sim + '%';
        } catch (e) { /* ignore */ }
    },

    _populateCountryDropdown() {
        const sel = document.getElementById('submitLocation');
        if (!sel || sel.tagName !== 'SELECT') return;
        const saved = document.getElementById('userLocation')?.value || '';
        const countries = [
            'Argentina', 'Australia', 'Austria', 'Belgium', 'Brazil',
            'Canada', 'Chile', 'China', 'Colombia', 'Croatia',
            'Czech Republic', 'Denmark', 'Finland', 'France', 'Germany',
            'Hong Kong', 'Hungary', 'Iceland', 'India', 'Indonesia',
            'Ireland', 'Israel', 'Italy', 'Japan', 'Luxembourg',
            'Malaysia', 'Mexico', 'Netherlands', 'New Zealand', 'Norway',
            'Peru', 'Philippines', 'Poland', 'Portugal', 'Romania',
            'Russia', 'Scotland', 'Serbia', 'Singapore', 'South Africa',
            'South Korea', 'Spain', 'Sweden', 'Switzerland', 'Taiwan',
            'Thailand', 'United Kingdom', 'United States', 'Other'
        ];
        countries.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c;
            opt.textContent = c;
            if (c === saved) opt.selected = true;
            sel.appendChild(opt);
        });
    },

    /** Render the admin bracket tree with clickable player slots */
    renderAdminBracket() {
        document.getElementById('bracket').innerHTML = this.buildBracketHTML(true);
        this.scheduleBracketRedraw('bracket');
    },

    /**
     * Build the NCAA-style bracket HTML tree.
     * Creates left half (matches 0-15), finals, right half (matches 16-31).
     * Each player slot gets correct/incorrect/selected CSS classes.
     * @param {boolean} isAdmin - If true, slots are clickable for admin editing
     */
    buildBracketHTML(isAdmin) {
        const renderPlayer = (round, mi, player, clickable) => {
            if (!player) return `<div class="bp bp-tbd"><span class="bp-name">TBD</span></div>`;
            const sel = this.bracket[round]?.[mi] === player.id;
            const cls = this.getPlayerClasses(round, mi, player.id, sel);
            const click = clickable ? `onclick="app.selectWinner(${round}, ${mi}, ${player.id})"` : '';
            return `<div class="bp ${cls}" ${click} data-pid="${player.id}">
                <span class="bp-name">${UI.escapeHtml(player.name)}</span>
            </div>`;
        };

        const renderMatchup = (round, mi, clickable) => {
            const matches = this.getRoundMatches(round);
            const match = matches[mi];
            return `<div class="bm" data-r="${round}" data-m="${mi}">
                ${renderPlayer(round, mi, match.player1, clickable)}
                ${renderPlayer(round, mi, match.player2, clickable)}
            </div>`;
        };

        const buildHalf = (startMatch, side) => {
            let html = '';
            const roundConfigs = [];
            let ms = startMatch;
            for (let r = 0; r < 5; r++) {
                const halfCount = (32 / Math.pow(2, r)) / 2;
                const indices = [];
                for (let m = 0; m < halfCount; m++) indices.push(ms + m);
                roundConfigs.push({ round: r, matches: indices });
                ms = Math.floor(ms / 2);
            }
            const configs = side === 'right' ? [...roundConfigs].reverse() : roundConfigs;
            configs.forEach(({ round, matches: mi }) => {
                html += `<div class="br">`;
                html += `<div class="br-title">${ROUND_NAMES_SHORT[round]}</div>`;
                html += `<div class="br-matches">`;
                // Group matchups into pairs for CSS connector lines
                for (let i = 0; i < mi.length; i += 2) {
                    if (i + 1 < mi.length) {
                        html += `<div class="bm-pair">`;
                        html += renderMatchup(round, mi[i], isAdmin);
                        html += renderMatchup(round, mi[i + 1], isAdmin);
                        html += `</div>`;
                    } else {
                        html += renderMatchup(round, mi[i], isAdmin);
                    }
                }
                html += `</div></div>`;
            });
            return html;
        };

        const finalHtml = `<div class="br br-final">
            <div class="br-title">${ROUND_NAMES_SHORT[5]}</div>
            <div class="br-matches">${renderMatchup(5, 0, isAdmin)}</div>
        </div>`;

        return `<div class="ncaa-bracket">
            <svg class="bracket-svg"></svg>
            <div class="bracket-cols">
                <div class="bracket-half-left">${buildHalf(0, 'left')}</div>
                ${finalHtml}
                <div class="bracket-half-right">${buildHalf(16, 'right')}</div>
            </div>
        </div>`;
    },

    // ── SVG bracket connector lines ──────────────────────────────

    /**
     * Schedule a bracket SVG redraw after layout settles.
     * Uses double-rAF to ensure DOM measurements are accurate.
     * Also re-initializes pinch-to-zoom and player tooltips.
     */
    scheduleBracketRedraw(containerId) {
        // Double rAF to ensure layout is fully computed (fixes small bracket on gender switch)
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                this._resetBracketScale();
                this.drawBracketSVG(containerId);
                this._scaleBracketToFit();
                // Reset and re-init pinch-to-zoom on mobile
                const wrapper = document.querySelector('.bracket-tree-wrapper');
                if (wrapper) {
                    wrapper._pinchInited = false;
                    const oldControls = wrapper.querySelector('.bracket-zoom-controls');
                    if (oldControls) oldControls.remove();
                    initBracketPinchZoom(wrapper);
                }
            });
        });
        this._attachBracketResizeWatcher(containerId);
        this._initPlayerTooltip();
    },

    /** Remove any transform/scale from the bracket (prep for redraw or screenshot) */
    _resetBracketScale() {
        const bracket = document.querySelector('.ncaa-bracket');
        const wrapper = document.querySelector('.bracket-tree-wrapper');
        if (bracket) {
            bracket.style.transform = '';
            bracket.style.transformOrigin = '';
        }
        if (wrapper) wrapper.style.height = '';
    },

    /** Scale the bracket down to fit within its wrapper width */
    _scaleBracketToFit() {
        const bracket = document.querySelector('.ncaa-bracket');
        const wrapper = document.querySelector('.bracket-tree-wrapper');
        if (!bracket || !wrapper) return;
        const bracketW = bracket.scrollWidth;
        const bracketH = bracket.scrollHeight;
        const wrapperW = wrapper.clientWidth;
        if (bracketW > wrapperW && bracketW > 0) {
            const scale = wrapperW / bracketW;
            bracket.style.transformOrigin = 'top left';
            bracket.style.transform = `scale(${scale})`;
            wrapper.style.height = Math.ceil(bracketH * scale) + 'px';
        }
    },

    _bracketResizeCleanup: null,

    /** Watch for wrapper resize events and redraw bracket (skip if user is manually zoomed) */
    _attachBracketResizeWatcher(containerId) {
        // Clean up previous watchers
        if (this._bracketResizeCleanup) {
            this._bracketResizeCleanup();
            this._bracketResizeCleanup = null;
        }

        let rafId = null;
        const redraw = () => {
            // Skip if user is manually zoomed
            const wrapper = document.querySelector('.bracket-tree-wrapper');
            if (wrapper && wrapper._isManualZoom && wrapper._isManualZoom()) return;
            if (rafId) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(() => {
                this._resetBracketScale();
                this.drawBracketSVG(containerId);
                this._scaleBracketToFit();
            });
        };

        // Watch the scroll wrapper for size changes
        const wrapper = document.querySelector('.bracket-tree-wrapper') ||
                        document.getElementById('bracket');
        let ro = null;
        if (wrapper && typeof ResizeObserver !== 'undefined') {
            ro = new ResizeObserver(redraw);
            ro.observe(wrapper);
        }

        // Window resize as fallback
        window.addEventListener('resize', redraw);

        this._bracketResizeCleanup = () => {
            if (ro) ro.disconnect();
            window.removeEventListener('resize', redraw);
            if (rafId) cancelAnimationFrame(rafId);
        };
    },

    // ── Player hover tooltip ─────────────────────────────────────

    /**
     * Initialize hover tooltips for bracket player slots.
     * Shows player name, Japanese name, prefecture, rank, and photo.
     * Uses event delegation — only initialized once (_tooltipInited flag).
     */
    _initPlayerTooltip() {
        if (this._tooltipInited) return;
        this._tooltipInited = true;

        const tooltip = document.createElement('div');
        tooltip.className = 'player-tooltip';
        tooltip.style.display = 'none';
        document.body.appendChild(tooltip);
        this._tooltip = tooltip;

        let hideTimer = null;

        document.addEventListener('mouseover', (e) => {
            const bp = e.target.closest('.bp[data-pid]');
            if (!bp) return;
            clearTimeout(hideTimer);
            const pid = parseInt(bp.dataset.pid);
            const tooltipGender = this.currentView === 'liveBracket' ? this._liveBracketGender : this.currentGender;
            const players = tooltipGender === 'men' ? this.menPlayers : this.womenPlayers;
            const player = players.find(p => p.id === pid);
            if (!player) return;

            const rankStr = String(player.rank);
            const rankLabel = rankStr.startsWith('R') ? `${rankStr.slice(1)} Dan Renshi` : `${rankStr} Dan`;
            const imgHtml = player.img
                ? `<img class="tooltip-avatar" src="${UI.escapeHtml(player.img)}" alt="">`
                : `<div class="tooltip-avatar tooltip-avatar-fallback">${UI.escapeHtml(player.name.charAt(0))}</div>`;

            tooltip.innerHTML = `
                <div class="tooltip-inner">
                    ${imgHtml}
                    <div class="tooltip-info">
                        <div class="tooltip-name">${UI.escapeHtml(player.name)}</div>
                        ${player.nameJp ? `<div class="tooltip-name-jp">${UI.escapeHtml(player.nameJp)}</div>` : ''}
                        <div class="tooltip-details">
                            <span>${UI.escapeHtml(player.prefecture)}</span>
                            <span>${rankLabel}</span>
                            ${player.age ? `<span>Age ${player.age}</span>` : ''}
                        </div>
                    </div>
                </div>`;

            const rect = bp.getBoundingClientRect();
            tooltip.style.display = 'block';
            const tw = tooltip.offsetWidth;
            const th = tooltip.offsetHeight;
            let left = rect.left + rect.width / 2 - tw / 2;
            let top = rect.top - th - 8;
            if (top < 4) top = rect.bottom + 8;
            if (left < 4) left = 4;
            if (left + tw > window.innerWidth - 4) left = window.innerWidth - tw - 4;
            tooltip.style.left = left + 'px';
            tooltip.style.top = top + 'px';
        });

        document.addEventListener('mouseout', (e) => {
            const bp = e.target.closest('.bp[data-pid]');
            if (!bp) return;
            hideTimer = setTimeout(() => { tooltip.style.display = 'none'; }, 150);
        });
    },

    /**
     * Draw SVG connector lines between bracket matchups.
     * Calculates positions from DOM bounding rects and draws
     * horizontal + vertical lines connecting each pair to its next-round match.
     */
    drawBracketSVG(containerId) {
        const container = containerId
            ? document.getElementById(containerId)
            : document.querySelector('.ncaa-bracket');
        if (!container) return;

        const svg = container.querySelector('.bracket-svg');
        if (!svg) return;

        svg.setAttribute('width', container.scrollWidth);
        svg.setAttribute('height', container.scrollHeight);
        svg.innerHTML = '';

        const matchups = container.querySelectorAll('.bm');
        const positions = {};

        matchups.forEach(el => {
            const r = parseInt(el.dataset.r);
            const m = parseInt(el.dataset.m);
            const box = el.getBoundingClientRect();
            const parentBox = container.getBoundingClientRect();
            const x = box.left - parentBox.left + container.scrollLeft;
            const y = box.top - parentBox.top + container.scrollTop;
            if (!positions[r]) positions[r] = {};
            positions[r][m] = {
                left: x,
                right: x + box.width,
                centerY: y + box.height / 2
            };
        });

        const lineColor = 'rgba(255,255,255,0.35)';
        const lineWidth = 1.5;

        const line = (x1, y1, x2, y2) => {
            const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            l.setAttribute('x1', x1); l.setAttribute('y1', y1);
            l.setAttribute('x2', x2); l.setAttribute('y2', y2);
            l.setAttribute('stroke', lineColor);
            l.setAttribute('stroke-width', lineWidth);
            svg.appendChild(l);
        };

        for (let r = 0; r < 5; r++) {
            const matchCount = 32 / Math.pow(2, r);
            for (let m = 0; m < matchCount; m += 2) {
                const top = positions[r]?.[m];
                const bot = positions[r]?.[m + 1];
                const next = positions[r + 1]?.[Math.floor(m / 2)];
                if (!top || !bot || !next) continue;

                const nextCenterX = (next.left + next.right) / 2;
                const topCenterX = (top.left + top.right) / 2;
                const goingRight = nextCenterX > topCenterX;

                if (goingRight) {
                    const midX = (top.right + next.left) / 2;
                    line(top.right, top.centerY, midX, top.centerY);
                    line(bot.right, bot.centerY, midX, bot.centerY);
                    line(midX, top.centerY, midX, bot.centerY);
                    const midY = (top.centerY + bot.centerY) / 2;
                    line(midX, midY, next.left, next.centerY);
                } else {
                    const midX = (top.left + next.right) / 2;
                    line(top.left, top.centerY, midX, top.centerY);
                    line(bot.left, bot.centerY, midX, bot.centerY);
                    line(midX, top.centerY, midX, bot.centerY);
                    const midY = (top.centerY + bot.centerY) / 2;
                    line(midX, midY, next.right, next.centerY);
                }
            }
        }
    },

    /** Return CSS classes for a bracket player slot: 'selected', 'correct', 'incorrect' */
    getPlayerClasses(round, matchIndex, playerId, isSelected) {
        let classes = '';
        if (isSelected) classes += 'selected ';
        if (!this.adminMode && this.actualResults) {
            const actual = this.actualResults[round]?.[matchIndex];
            if (actual !== undefined) {
                if (actual === playerId && isSelected) classes += 'correct';
                else if (isSelected && actual !== playerId) classes += 'incorrect';
            }
        }
        return classes;
    },

    // ── Actual results ──────────────────────────────────────────

    /** Load official tournament results and final ippon technique from Firestore */
    async loadActualResults() {
        try {
            const doc = await db.collection('actualResults-' + this.currentGender).doc('current').get();
            this.actualResults = doc.exists ? (doc.data().predictions || null) : null;
            // Cache actual technique for stats bar display
            try {
                const techDoc = await db.collection('settings').doc('actualTechnique-' + this.currentGender).get();
                this._actualTechniqueCache = techDoc.exists ? (techDoc.data().technique || null) : null;
            } catch { this._actualTechniqueCache = null; }
        } catch (e) { console.error('Error loading actual results:', e); }
    },

    // ── Leaderboard ─────────────────────────────────────────────

    _lbGender: null,
    _lbPage: 0,
    _lbPageSize: 10,
    _lbScores: [],

    /**
     * Fetch all brackets, score them against actual results, sort by points, and render.
     * If no results exist yet, shows brackets sorted by submission time with '-' rankings.
     */
    async updateLeaderboard(gender) {
        const g = gender || this._lbGender || this.currentGender;
        this._lbGender = g;
        // Skip if leaderboard is not currently rendered
        if (!document.getElementById('leaderboardContent')) return;
        try {
            const resultsDoc = await db.collection('actualResults-' + g).doc('current').get();
            const hasResults = resultsDoc.exists && Object.keys(resultsDoc.data().predictions || {}).length > 0;
            const snap = await db.collection('brackets-' + g).get();
            if (snap.empty) {
                document.getElementById('leaderboardContent').innerHTML =
                    '<p style="text-align:center;color:#666;padding:40px;">No brackets submitted yet.</p>';
                return;
            }
            if (!hasResults) {
                // No results yet — show all brackets sorted by submission time
                const entries = [];
                snap.forEach(doc => {
                    const data = doc.data();
                    if (!data.predictions) return;
                    entries.push({ uid: doc.id, name: data.displayName || doc.id, score: '-', correct: 0, total: 0, location: data.location || '', techniqueBonus: 0, timestamp: data.timestamp, rank: '-' });
                });
                entries.sort((a, b) => {
                    const aTime = a.timestamp?.toMillis?.() || a.timestamp?.seconds * 1000 || Infinity;
                    const bTime = b.timestamp?.toMillis?.() || b.timestamp?.seconds * 1000 || Infinity;
                    return aTime - bTime;
                });
                this._lbScores = entries;
                this._lbPage = 0;
                this._renderLeaderboard();
                return;
            }
            const actualResults = resultsDoc.data().predictions || {};
            if (g === this.currentGender) this.actualResults = actualResults;
            const roundPoints = [1, 2, 4, 8, 16, 32];
            const scores = [];
            const totalActual = Object.values(actualResults).reduce((s, r) => s + Object.keys(r).length, 0);
            // Load actual technique + score for tiebreaker
            let actualTechnique = null, actualScore = null;
            try {
                const techDoc = await db.collection('settings').doc('actualTechnique-' + g).get();
                if (techDoc.exists) {
                    actualTechnique = techDoc.data().technique || null;
                    actualScore = techDoc.data().score || null;
                }
            } catch (e) { /* ignore */ }
            snap.forEach(doc => {
                const data = doc.data();
                if (!data.predictions) return;
                let score = 0, correct = 0;
                const roundCorrect = [0, 0, 0, 0, 0, 0];
                for (let round = 0; round < 6; round++) {
                    const userPicks = data.predictions[round] || {};
                    const actual = actualResults[round] || {};
                    Object.keys(actual).forEach(m => {
                        if (userPicks[m] === actual[m]) { score += roundPoints[round]; correct++; roundCorrect[round]++; }
                    });
                }
                const techniqueBonus = actualTechnique && data.finalTechnique === actualTechnique ? 5 : 0;
                const perfectBonus = (correct === totalActual && totalActual > 0) ? 50 : 0;
                score += techniqueBonus + correct + perfectBonus;
                scores.push({ uid: doc.id, name: data.displayName || doc.id, score, correct, total: totalActual, location: data.location || '', techniqueBonus, timestamp: data.timestamp });
            });
            // Sort: total points desc (includes technique bonus), then earlier submission
            scores.sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                const aTime = a.timestamp?.toMillis?.() || a.timestamp?.seconds * 1000 || Infinity;
                const bTime = b.timestamp?.toMillis?.() || b.timestamp?.seconds * 1000 || Infinity;
                return aTime - bTime;
            });
            let rank = 1, prevScore = null;
            scores.forEach((entry, i) => {
                entry.rank = i + 1;
            });
            this._lbScores = scores;
            this._lbPage = 0;
            this._renderLeaderboard();
        } catch (e) {
            console.error('Error updating leaderboard:', e, e.stack);
            document.getElementById('leaderboardContent').innerHTML = '<p style="text-align:center;color:#f00;">Error loading leaderboard</p>';
        }
    },

    /** Render the leaderboard page shell with skeleton loading state */
    renderLeaderboardPage() {
        const container = document.getElementById('gameContainer');
        container.innerHTML = `
            <div class="page-view">
                <div class="lb-header">
                    <div>
                        <h1 class="page-title">LEADERBOARD</h1>
                        <p class="lb-subtitle">All Japan Kendo Championship Bracket Challenge</p>
                    </div>
                    <div class="lb-tabs">
                        <button class="lb-tab${(this._lbGender || this.currentGender) === 'men' ? ' active' : ''}" onclick="app.switchLeaderboardGender('men')" id="lbMenTab">MENS AJKC</button>
                        <button class="lb-tab${(this._lbGender || this.currentGender) === 'women' ? ' active' : ''}" onclick="app.switchLeaderboardGender('women')" id="lbWomenTab">WOMENS AJKC</button>
                    </div>
                </div>
                <div id="leaderboardContent">
                    <div class="skeleton-podium">
                        <div class="skeleton skeleton-podium-item"></div>
                        <div class="skeleton skeleton-podium-item"></div>
                        <div class="skeleton skeleton-podium-item"></div>
                    </div>
                    <div class="skeleton skeleton-row"></div>
                    <div class="skeleton skeleton-row"></div>
                    <div class="skeleton skeleton-row"></div>
                    <div class="skeleton skeleton-row"></div>
                    <div class="skeleton skeleton-row"></div>
                </div>
                <!-- Sponsor slot -->
                <div class="sponsor-slot" id="sponsorLeaderboard" style="display:none"></div>
                <div class="ad-slot" id="adLeaderboard" style="display:none"></div>
            </div>`;
        this.updateLeaderboard();
        this._startLeaderboardListener();
        this._initPullToRefresh('leaderboardContent', () => this.updateLeaderboard());
    },

    /** Add pull-to-refresh touch gesture to a scrollable container */
    _initPullToRefresh(containerId, refreshFn) {
        const container = document.getElementById(containerId);
        if (!container || container._ptrInited) return;
        container._ptrInited = true;

        let startY = 0, pulling = false;
        const indicator = document.createElement('div');
        indicator.className = 'ptr-indicator';
        indicator.style.display = 'none';
        indicator.textContent = '\u2193 Pull to refresh';
        container.parentElement.insertBefore(indicator, container);

        container.addEventListener('touchstart', (e) => {
            if (container.scrollTop === 0 || window.scrollY === 0) {
                startY = e.touches[0].clientY;
                pulling = true;
            }
        }, { passive: true });

        container.addEventListener('touchmove', (e) => {
            if (!pulling) return;
            const dy = e.touches[0].clientY - startY;
            if (dy > 40 && window.scrollY === 0) {
                indicator.style.display = 'block';
                indicator.textContent = dy > 80 ? '\u2191 Release to refresh' : '\u2193 Pull to refresh';
            } else {
                indicator.style.display = 'none';
            }
        }, { passive: true });

        container.addEventListener('touchend', (e) => {
            if (!pulling) return;
            pulling = false;
            if (indicator.style.display === 'block' && indicator.textContent.includes('Release')) {
                indicator.textContent = 'Refreshing...';
                indicator.classList.add('refreshing');
                refreshFn();
                setTimeout(() => {
                    indicator.style.display = 'none';
                    indicator.classList.remove('refreshing');
                }, 1000);
            } else {
                indicator.style.display = 'none';
            }
        }, { passive: true });
    },

    /** Render leaderboard content: podium (top 3) + paginated table + pinned "You" row */
    _renderLeaderboard() {
        const scores = this._lbScores;
        const uid = this.currentUser?.uid;
        const container = document.getElementById('leaderboardContent');
        if (!scores.length) { container.innerHTML = '<p style="text-align:center;color:#666;padding:40px;">No data</p>'; return; }
        const noResults = scores[0]?.rank === '-';
        const _fmtRank = (r) => r === '-' ? '-' : String(r).padStart(2, '0');
        const top3 = scores.slice(0, 3);
        const podiumOrder = [top3[1], top3[0], top3[2]];
        const podiumHtml = podiumOrder.map((entry, i) => {
            if (!entry) return '<div class="lb-podium-item lb-podium-empty"></div>';
            const pos = i === 1 ? 1 : i === 0 ? 2 : 3;
            const isCenter = pos === 1;
            return `<div class="lb-podium-item lb-podium-${pos}${isCenter ? ' lb-podium-center' : ''}" onclick="app.viewBracketFromLeaderboard('${UI.escapeHtml(entry.uid)}')" style="cursor:pointer;">
                <div class="lb-podium-rank">${noResults ? '-' : String(pos).padStart(2, '0')}</div>
                ${isCenter && !noResults ? '<div class="lb-podium-trophy">\ud83c\udfc6</div>' : ''}
                <div class="lb-podium-name">${UI.escapeHtml(entry.name)}</div>
                <div class="lb-podium-loc">${UI.escapeHtml(entry.location || '')}</div>
                <div class="lb-podium-pts"><strong>${entry.score}</strong> <small>${noResults ? '' : 'PTS'}</small></div>
                <div class="lb-podium-view">VIEW BRACKET</div>
            </div>`;
        }).join('');
        const start = this._lbPage * this._lbPageSize;
        const pageEntries = scores.slice(start, start + this._lbPageSize);
        const hasMore = start + this._lbPageSize < scores.length;
        const _fmtDate = (ts) => {
            if (!ts) return '—';
            const d = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000);
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        };
        const rowsHtml = pageEntries.map(entry => {
            const isYou = entry.uid === uid;
            return `<div class="lb-row${isYou ? ' lb-row-you' : ''}">
                <span class="lb-row-rank">${_fmtRank(entry.rank)}</span>
                <span class="lb-row-name">${UI.escapeHtml(entry.name)}${entry.location ? ' <span class="lb-row-loc">' + UI.escapeHtml(entry.location) + '</span>' : ''}</span>
                <span class="lb-row-correct">${noResults ? '-' : entry.correct + ' / ' + entry.total}</span>
                <span class="lb-row-date">${_fmtDate(entry.timestamp)}</span>
                <span class="lb-row-pts">${entry.score}</span>
            </div>`;
        }).join('');
        // Pinned "You" row
        const youEntry = uid ? scores.find(e => e.uid === uid) : null;
        const youRowHtml = youEntry ? `<div class="lb-row lb-row-you">
                <span class="lb-row-rank">${youEntry.rank === '-' ? '-' : '#' + youEntry.rank}</span>
                <span class="lb-row-name">You (${UI.escapeHtml(youEntry.name)})${youEntry.location ? ' <span class="lb-row-loc">' + UI.escapeHtml(youEntry.location) + '</span>' : ''}</span>
                <span class="lb-row-correct">${noResults ? '-' : youEntry.correct + ' / ' + youEntry.total}</span>
                <span class="lb-row-date">${_fmtDate(youEntry.timestamp)}</span>
                <span class="lb-row-pts">${youEntry.score}</span>
            </div>` : '';
        const loadMoreHtml = hasMore
            ? '<div style="text-align:center;margin-top:16px"><button class="bracket-action-btn" onclick="app._lbLoadMore()">LOAD MORE RANKINGS</button></div>'
            : '';
        container.innerHTML = `
            <div class="ad-slot" id="adLeaderboardTop" style="display:none"></div>
            ${noResults ? '' : '<div class="lb-podium">' + podiumHtml + '</div>'}
            ${youRowHtml}
            <div class="lb-table">
                <div class="lb-table-header"><span>RANK</span><span>NAME</span><span class="lb-row-correct">PICKS</span><span class="lb-row-date">SUBMITTED</span><span>PTS</span></div>
                <div id="lbRows">${rowsHtml}</div>
            </div>
            ${loadMoreHtml}`;
    },

    /** Append next page of leaderboard rows and update load-more button */
    _lbLoadMore() {
        this._lbPage++;
        const start = this._lbPage * this._lbPageSize;
        const pageEntries = this._lbScores.slice(start, start + this._lbPageSize);
        const uid = this.currentUser?.uid;
        const hasMore = start + this._lbPageSize < this._lbScores.length;
        const noResults = this._lbScores[0]?.rank === '-';
        const newRows = pageEntries.map(entry => {
            const isYou = entry.uid === uid;
            const _fmtD = (ts) => { if (!ts) return '\u2014'; const d = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); };
            return `<div class="lb-row${isYou ? ' lb-row-you' : ''}">
                <span class="lb-row-rank">${entry.rank === '-' ? '-' : String(entry.rank).padStart(2, '0')}</span>
                <span class="lb-row-name">${UI.escapeHtml(entry.name)}${entry.location ? ' <span class="lb-row-loc">' + UI.escapeHtml(entry.location) + '</span>' : ''}</span>
                <span class="lb-row-correct">${noResults ? '-' : entry.correct + ' / ' + entry.total}</span>
                <span class="lb-row-date">${_fmtD(entry.timestamp)}</span>
                <span class="lb-row-pts">${entry.score}</span>
            </div>`;
        }).join('');
        document.getElementById('lbRows').insertAdjacentHTML('beforeend', newRows);
        if (!hasMore) {
            const btn = document.querySelector('#leaderboardContent .bracket-action-btn');
            if (btn) btn.parentElement.remove();
        }
    },

    switchLeaderboardGender(gender) {
        document.getElementById('lbMenTab').classList.toggle('active', gender === 'men');
        document.getElementById('lbWomenTab').classList.toggle('active', gender === 'women');
        this.updateLeaderboard(gender);
    },

    _warnIfPicking(action) {
        if (this.viewingOtherBracket) return false;
        if (this.currentView === 'bracket' && this.gameState === 'picking' &&
            this.hasAnyPicks() && !this.isBracketComplete() && !this.userBracketData) {
            return !confirm('You have an incomplete bracket. Your unsaved picks will be lost. Continue?');
        }
        return false;
    },

    showLeaderboard() {
        if (this._warnIfPicking()) return;
        this._closeNav();
        this._navGen++;
        this._lbGender = this.currentGender;
        this.currentView = 'leaderboard';
        this._setActiveNav('navLeaderboard');
        delete document.body.dataset.intensity;
        this.render();
    },

    closeLeaderboard() {
        this._navGen++;
        this.currentView = 'bracket';
        this._setActiveNav('navMyBracket');
        this.render();
    },

    _lbUnsubscribe: null,

    /** Start a Firestore real-time listener that refreshes leaderboard on new submissions */
    _startLeaderboardListener() {
        this._stopLeaderboardListener();
        const g = this._lbGender || this.currentGender;
        this._lbUnsubscribe = db.collection('brackets-' + g).onSnapshot(() => {
            if (this.currentView === 'leaderboard') {
                this.updateLeaderboard(g);
            }
        }, () => {});
    },

    _stopLeaderboardListener() {
        if (this._lbUnsubscribe) {
            this._lbUnsubscribe();
            this._lbUnsubscribe = null;
        }
    },

    /** Navigate to a specific user's bracket from the leaderboard */
    viewBracketFromLeaderboard(uid) {
        const lbGender = this._lbGender || this.currentGender;
        // Switch view without rendering — loadSpecificBracket will render
        this.currentView = 'bracket';
        if (lbGender !== this.currentGender) {
            this.currentGender = lbGender;
            this.players = lbGender === 'men' ? this.menPlayers : this.womenPlayers;
            document.body.className = lbGender === 'women' ? 'women' : '';
            document.getElementById('menBtn')?.classList.toggle('active', lbGender === 'men');
            document.getElementById('womenBtn')?.classList.toggle('active', lbGender === 'women');
        }
        this._setActiveNav('navLeaderboard');
        this.loadSpecificBracket(uid);
    },

    // ── View all brackets ───────────────────────────────────────

    async viewAllBrackets() {
        if (this._warnIfPicking()) return;
        this._closeNav();
        this._navGen++;
        this.currentView = 'allBrackets';
        this._setActiveNav('navAllBrackets');
        delete document.body.dataset.intensity;
        this.render();
    },

    /** Render the "All Brackets" page with search input and paginated list */
    renderAllBracketsPage() {
        const container = document.getElementById('gameContainer');
        container.innerHTML = `
            <div class="page-view">
                <h1 class="page-title">ALL BRACKETS</h1>
                <div class="ab-container">
                    <span style="position:absolute;left:16px;top:50%;transform:translateY(-50%);color:rgba(255,255,255,0.3);font-size:0.9em;pointer-events:none;">&#128269;</span>
                    <input type="text" id="bracketSearch" class="submit-name-input" style="width:100%;padding-left:34px;" placeholder="Find bracket by name or country..." oninput="app.filterBrackets(this.value)" />
                </div>
                <div id="bracketsList" class="bracket-list ab-container"></div>
                <div class="ad-slot" id="adAllBrackets" style="display:none"></div>
            </div>`;
        this._loadAllBrackets();
    },

    /** Fetch all men's + women's brackets from Firestore and sort by date */
    async _loadAllBrackets() {
        const bracketsList = document.getElementById('bracketsList');
        try {
            const [menSnap, womenSnap] = await Promise.all([
                db.collection('brackets-men').get(),
                db.collection('brackets-women').get()
            ]);
            this._allBracketItems = [];
            const processSnap = (snap, gender) => {
                snap.forEach(doc => {
                    const data = doc.data();
                    const uid = doc.id;
                    const name = data.displayName || 'Anonymous';
                    const location = data.location || '';
                    const date = data.timestamp ? data.timestamp.toDate() : null;
                    const dateStr = date ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
                    this._allBracketItems.push({ uid, name, location, date, dateStr, gender });
                });
            };
            processSnap(menSnap, 'men');
            processSnap(womenSnap, 'women');
            if (!this._allBracketItems.length) {
                bracketsList.innerHTML = '<p style="text-align:center;color:rgba(255,255,255,0.4);padding:40px;">No brackets saved yet!</p>';
            } else {
                this._allBracketItems.sort((a, b) => (b.date || 0) - (a.date || 0));
                this._renderBracketList(this._allBracketItems);
            }
        } catch (e) {
            bracketsList.innerHTML = '<p style="text-align:center;color:#f00;">Error loading brackets</p>';
            console.error('Error loading brackets:', e);
        }
    },

    _abPage: 0,
    _abPageSize: 15,
    _abFiltered: null,

    _renderBracketList(items) {
        this._abFiltered = items;
        this._abPage = 0;
        this._renderBracketPage();
    },

    _renderBracketPage() {
        const items = this._abFiltered || [];
        const bracketsList = document.getElementById('bracketsList');
        if (!items.length) {
            bracketsList.innerHTML = '<p style="text-align:center;color:rgba(255,255,255,0.4);padding:20px;">No matches found</p>';
            return;
        }
        const isMe = (uid) => uid === this.currentUser?.uid;
        const start = this._abPage * this._abPageSize;
        const pageItems = items.slice(start, start + this._abPageSize);
        const hasMore = start + this._abPageSize < items.length;
        const total = items.length;

        let html = `<p style="color:rgba(255,255,255,0.3);font-size:0.8em;margin-bottom:12px;">${total} bracket${total !== 1 ? 's' : ''}</p>`;
        html += pageItems.map(item => {
            const genderBadge = item.gender === 'men'
                ? '<span class="ab-gender-badge ab-gender-men">MEN</span>'
                : '<span class="ab-gender-badge ab-gender-women">WOMEN</span>';
            return `
            <div class="ab-row${isMe(item.uid) ? ' ab-row-you' : ''} ab-row-${item.gender}" onclick="app.loadSpecificBracket('${UI.escapeHtml(item.uid)}', '${item.gender}')">
                <div class="ab-info">
                    <div class="ab-name-wrap">
                        ${isMe(item.uid) ? '<span class="ab-you-label">YOUR BRACKET</span>' : ''}
                        <span class="ab-name">${UI.escapeHtml(item.name)}</span>
                        ${genderBadge}
                        ${item.location ? '<span class="ab-loc">' + UI.escapeHtml(item.location) + '</span>' : ''}
                    </div>
                </div>
                <div class="ab-meta">
                    <div class="ab-date-wrap">
                        <span class="ab-date-label">SUBMITTED</span>
                        <span class="ab-date">${UI.escapeHtml(item.dateStr)}</span>
                    </div>
                    <span class="ab-view">VIEW DETAILS →</span>
                </div>
            </div>`;
        }).join('');

        if (hasMore) {
            html += '<div style="text-align:center;margin-top:16px;"><button class="bracket-action-btn" onclick="app._abLoadMore()">LOAD MORE</button></div>';
        }
        bracketsList.innerHTML = html;
    },

    _abLoadMore() {
        this._abPage++;
        const items = this._abFiltered || [];
        const isMe = (uid) => uid === this.currentUser?.uid;
        const start = this._abPage * this._abPageSize;
        const pageItems = items.slice(start, start + this._abPageSize);
        const hasMore = start + this._abPageSize < items.length;

        const rows = pageItems.map(item => {
            const genderBadge = item.gender === 'men'
                ? '<span class="ab-gender-badge ab-gender-men">MEN</span>'
                : '<span class="ab-gender-badge ab-gender-women">WOMEN</span>';
            return `
            <div class="ab-row${isMe(item.uid) ? ' ab-row-you' : ''} ab-row-${item.gender}" onclick="app.loadSpecificBracket('${UI.escapeHtml(item.uid)}', '${item.gender}')">
                <div class="ab-info">
                    <div class="ab-name-wrap">
                        ${isMe(item.uid) ? '<span class="ab-you-label">YOUR BRACKET</span>' : ''}
                        <span class="ab-name">${UI.escapeHtml(item.name)}</span>
                        ${genderBadge}
                        ${item.location ? '<span class="ab-loc">' + UI.escapeHtml(item.location) + '</span>' : ''}
                    </div>
                </div>
                <div class="ab-meta">
                    <div class="ab-date-wrap">
                        <span class="ab-date-label">SUBMITTED</span>
                        <span class="ab-date">${UI.escapeHtml(item.dateStr)}</span>
                    </div>
                    <span class="ab-view">VIEW DETAILS →</span>
                </div>
            </div>`;
        }).join('');

        // Remove load more button and append new rows
        const btn = document.querySelector('#bracketsList .bracket-action-btn');
        if (btn) btn.parentElement.remove();
        document.getElementById('bracketsList').insertAdjacentHTML('beforeend', rows);
        if (hasMore) {
            document.getElementById('bracketsList').insertAdjacentHTML('beforeend',
                '<div style="text-align:center;margin-top:16px;"><button class="bracket-action-btn" onclick="app._abLoadMore()">LOAD MORE</button></div>');
        }
    },

    /** Filter the bracket list by search query (name or country) */
    filterBrackets(query) {
        if (!this._allBracketItems) return;
        const q = query.toLowerCase().trim();
        const filtered = q
            ? this._allBracketItems.filter(item => item.name.toLowerCase().includes(q) || item.location.toLowerCase().includes(q))
            : this._allBracketItems;
        this._renderBracketList(filtered);
    },

    /**
     * Load a specific user's bracket by UID. Switches gender if needed.
     * Uses _navGen guard to prevent rendering if user navigated away.
     */
    async loadSpecificBracket(uid, gender) {
        const navGen = ++this._navGen;
        try {
            const g = gender || this.currentGender;
            if (g !== this.currentGender) {
                this.currentGender = g;
                this.players = g === 'men' ? this.menPlayers : this.womenPlayers;
                this.bracket = {};
                this.actualResults = null;
                document.body.className = g === 'women' ? 'women' : '';
            }
            const doc = await db.collection('brackets-' + g).doc(uid).get();
            if (navGen !== this._navGen) return; // User navigated away
            if (doc.exists) {
                const data = doc.data();
                this.bracket = data.predictions || {};
                this._viewingBracketName = data.displayName || 'Anonymous';
                this.viewingOtherBracket = (uid !== this.currentUser?.uid);
                this.currentView = 'bracket';
                this.gameState = 'bracket-summary';
                UI.showBackToMine(this.viewingOtherBracket);
                await this.loadActualResults();
                if (navGen !== this._navGen) return; // User navigated away
                this.render();
            } else {
                showToast('Bracket not found.', 'error');
            }
        } catch (e) {
            console.error('Error loading bracket:', e);
            showToast('Error loading bracket', 'error');
        }
    },

    /** Return to the user's own bracket (from viewing someone else's) */
    viewMyBracket() {
        this._closeNav();
        this._navGen++;
        this.currentView = 'bracket';
        this.viewingOtherBracket = false;
        UI.showBackToMine(false);
        this._setActiveNav('navMyBracket');
        if (this.userBracketData) {
            this.bracket = { ...this.userBracketData };
            this.gameState = this.isBracketComplete() ? 'bracket-summary' : 'picking';
            if (this.gameState === 'picking') this.findFirstIncompleteMatch();
        } else {
            this.bracket = {};
            this.gameState = 'picking';
            this.gameRound = 0;
            this.gameMatch = 0;
        }
        this.render();
    },

    closeModal() {
        document.getElementById('bracketsModal').style.display = 'none';
        unlockBodyScroll();
    },

    // ── Menu ─────────────────────────────────────────────────

    toggleMenu() {
        document.getElementById('menuDropdown').classList.toggle('open');
    },

    closeMenu() {
        document.getElementById('menuDropdown').classList.remove('open');
    },

    // ── Bracket count ───────────────────────────────────────────

    async updateBracketCount() {
        try {
            const snap = await db.collection('brackets-' + this.currentGender).get();
            const count = snap.size;
            document.getElementById('bracketCount').textContent =
                `📊 ${count} Bracket${count !== 1 ? 's' : ''} Submitted`;
        } catch (e) {
            console.error('Error counting brackets:', e);
            document.getElementById('bracketCount').textContent = '📊 Error loading count';
        }
    },

    // ── Legal Pages ─────────────────────────────────────────────

    _legalTab: 'privacy',

    showLegal(tab) {
        this._legalTab = tab || 'privacy';
        this._navGen++;
        this.currentView = 'legal';
        this._setActiveNav(null);
        delete document.body.dataset.intensity;
        // Show mainApp if coming from landing
        document.getElementById('landingPage').style.display = 'none';
        document.getElementById('mainApp').style.display = 'block';
        this.render();
    },

    switchLegalTab(tab) {
        this._legalTab = tab;
        this.renderLegalPage();
    },

    /** Render legal page (Privacy Policy / Terms of Service) with tab switching */
    renderLegalPage() {
        const container = document.getElementById('gameContainer');
        const isPrivacy = this._legalTab === 'privacy';

        const privacySections = [
            { title: '1. Information We Collect', body: `<div class="legal-subsection"><p class="legal-sub-title">Account Information</p><p>Email address, username, and optional location if you choose to provide it.</p></div><div class="legal-subsection"><p class="legal-sub-title">Authentication Data</p><p>Login information through email/password or third-party sign-in providers such as Google.</p></div><div class="legal-subsection"><p class="legal-sub-title">Usage Data</p><p>Session information, bracket activity, and basic device or browser information collected automatically.</p></div>` },
            { title: '2. How We Use Your Information', body: 'We use your information to create and manage your account, display usernames on leaderboards or public features, operate and improve the platform, monitor performance, and communicate important updates.' },
            { title: '3. Cookies and Tracking', body: 'We may use cookies or similar technologies to keep you logged in and improve the user experience. By using the site, you consent to this use.' },
            { title: '4. Third-Party Services', body: 'We may use third-party services for authentication, analytics, hosting, and sponsor advertising. These services may collect limited information under their own privacy policies.' },
            { title: '5. Advertising and Sponsors', body: 'ajkcanarchy may display sponsor banners and advertising placements. We do not sell your personal information.' },
            { title: '6. Data Sharing', body: 'We may share limited information with service providers that help operate the platform, or when required by law. We do not sell personal data.' },
            { title: '7. Data Security', body: 'We take reasonable steps to protect your information, but no method of transmission or storage is completely secure.' },
            { title: '8. International Users', body: 'ajkcanarchy is accessible worldwide. By using the platform, you understand that your information may be processed in the United States.' },
            { title: '9. Children\&#39;s Privacy', body: 'This platform is not intended for children under 13, and we do not knowingly collect personal information from children.' },
            { title: '10. Your Rights', body: 'You may request account deletion or ask for access to your information by contacting jayeunnie@gmail.com.' },
            { title: '11. Changes to This Policy', body: 'We may update this Privacy Policy from time to time. Continued use of the site means you accept the updated version.' }
        ];

        const termsSections = [
            { title: '1. Use of the Platform', body: 'ajkcanarchy provides a free, for-fun bracket prediction game related to kendo competitions. No purchase is required, and no prizes or monetary rewards are currently offered.' },
            { title: '2. Accounts', body: 'To use certain features, you must create an account. You agree to provide accurate information, keep your login secure, and remain responsible for activity on your account. We may suspend or terminate accounts at our discretion.' },
            { title: '3. Usernames and Public Display', body: 'Usernames may appear publicly, including on leaderboards. Please do not use offensive, misleading, or inappropriate usernames. We reserve the right to change or remove usernames.' },
            { title: '4. Acceptable Use', body: 'You agree not to hack, disrupt, abuse, scrape, bot, or otherwise interfere with the platform or other users\' experience.' },
            { title: '5. Intellectual Property', body: 'All branding, site design, original content, and platform features of ajkcanarchy are owned by us unless otherwise stated. You may not copy or distribute them without permission.' },
            { title: '6. Advertising', body: 'The platform may include sponsor banners or other advertising placements. We are not responsible for third-party products, services, or claims.' },
            { title: '7. Disclaimer', body: 'This platform is provided for entertainment purposes only. We do not guarantee prediction accuracy, uninterrupted availability, or error-free operation.' },
            { title: '8. Limitation of Liability', body: 'To the fullest extent permitted by law, ajkcanarchy is not liable for damages, losses, data issues, or interruptions arising from your use of the platform.' },
            { title: '9. Termination', body: 'We may suspend or terminate access to the platform at any time, with or without notice, for any reason.' },
            { title: '10. Changes to Terms', body: 'We may update these Terms of Service from time to time. Continued use of the platform means you accept the revised terms.' },
            { title: '11. Contact', body: 'Questions about these Terms may be sent to jayeunnie@gmail.com.' }
        ];

        const sections = isPrivacy ? privacySections : termsSections;
        const sectionsHtml = sections.map(s =>
            `<div class="legal-card"><h3 class="legal-card-title">${s.title}</h3><div class="legal-card-body">${s.body}</div></div>`
        ).join('');

        container.innerHTML = `
            <div class="page-view legal-page">
                <div class="legal-header">
                    <p class="legal-label">AJKCANARCHY</p>
                    <h1 class="legal-main-title">Privacy Policy & Terms of Service</h1>
                    <p class="legal-intro">Clear information about how ajkcanarchy handles accounts, public usernames, login tracking, sponsor placements, and your use of the platform.</p>
                </div>

                <div class="legal-meta">
                    <div class="legal-meta-item"><span class="legal-meta-label">Last Updated</span><span class="legal-meta-value">March 20, 2026</span></div>
                    <div class="legal-meta-item"><span class="legal-meta-label">Contact</span><span class="legal-meta-value">jayeunnie@gmail.com</span></div>
                    <div class="legal-meta-item"><span class="legal-meta-label">Platform Type</span><span class="legal-meta-value">Free kendo bracket game</span></div>
                </div>

                <div class="legal-tabs">
                    <button class="legal-tab${isPrivacy ? ' active' : ''}" onclick="app.switchLegalTab('privacy')">PRIVACY POLICY</button>
                    <button class="legal-tab${!isPrivacy ? ' active' : ''}" onclick="app.switchLegalTab('terms')">TERMS OF SERVICE</button>
                </div>

                <div class="legal-preamble">
                    ${isPrivacy
                        ? 'ajkcanarchy operates an online bracket-style game platform related to kendo competitions. This Privacy Policy explains what information we collect, how we use it, and how we work to protect it.'
                        : 'By using ajkcanarchy, you agree to these Terms of Service. They explain the rules for using the platform, public usernames, sponsor advertising, and limitations of liability.'}
                </div>

                <div class="legal-sections">${sectionsHtml}</div>

                <div class="legal-notes">
                    <h2 class="legal-notes-title">Quick Notes</h2>
                    <div class="legal-notes-grid">
                        <div class="legal-note"><p class="legal-note-title">Public usernames</p><p>Usernames may appear on leaderboards or similar features, so avoid using personal information you do not want shown publicly.</p></div>
                        <div class="legal-note"><p class="legal-note-title">No prizes right now</p><p>The current version is free to play and does not offer prizes or monetary rewards.</p></div>
                        <div class="legal-note"><p class="legal-note-title">Sponsor placements</p><p>The site may include direct sponsor banners or branded placements, but ajkcanarchy is not responsible for third-party products or services.</p></div>
                    </div>
                </div>
            </div>`;
        window.scrollTo(0, 0);
    },

    // ── Live Bracket ─────────────────────────────────────────

    _liveBracketGender: 'men',

    showLiveBracket() {
        if (this._warnIfPicking()) return;
        this._closeNav();
        this._navGen++;
        this._liveBracketGender = this.currentGender;
        this.currentView = 'liveBracket';
        this._setActiveNav('navLiveBracket');
        delete document.body.dataset.intensity;
        this.render();
    },

    async showLandingLiveBracket() {
        this._navGen++;
        this.currentView = 'liveBracket';
        this._liveBracketGender = 'men';
        this._setActiveNav('navLiveBracket');
        delete document.body.dataset.intensity;
        document.getElementById('gameContainer').innerHTML = '';
        document.getElementById('landingPage').style.display = 'none';
        document.getElementById('mainApp').style.display = 'block';
        window.scrollTo(0, 0);
        this.render();
    },

    async _loadLiveResults(gender) {
        try {
            const doc = await db.collection('actualResults-' + gender).doc('current').get();
            return doc.exists ? (doc.data().predictions || {}) : {};
        } catch (e) {
            console.error('Error loading live results:', e);
            return {};
        }
    },

    /** Render live bracket: fetch official results and display as read-only bracket tree */
    async renderLiveBracketPage() {
        const container = document.getElementById('gameContainer');
        const gender = this._liveBracketGender;
        document.body.className = gender === 'women' ? 'women' : '';

        container.innerHTML = `
            <div class="page-view live-bracket-page">
                <h1 class="page-title">LIVE BRACKET</h1>
                <p class="live-bracket-subtitle">Official tournament results updated in real time</p>
                <div class="live-bracket-gender-tabs">
                    <button class="live-gender-tab ${gender === 'men' ? 'active' : ''}" data-gender="men" onclick="app._switchLiveGender('men')">MEN</button>
                    <button class="live-gender-tab ${gender === 'women' ? 'active' : ''}" data-gender="women" onclick="app._switchLiveGender('women')">WOMEN</button>
                </div>
                <div id="liveBracketContent">
                    <div class="skeleton skeleton-bracket" style="height:300px;border-radius:12px;"></div>
                </div>
            </div>`;

        const results = await this._loadLiveResults(gender);
        const players = gender === 'men' ? this.menPlayers : this.womenPlayers;

        // Build the bracket HTML using the actual results as bracket data
        const savedBracket = this.bracket;
        const savedPlayers = this.players;
        const savedActual = this.actualResults;
        const savedAdmin = this.adminMode;

        this.bracket = results;
        this.players = players;
        this.actualResults = null; // no correct/incorrect highlighting
        this.adminMode = false;

        const bracketHtml = this.buildBracketHTML(false);

        // Restore state
        this.bracket = savedBracket;
        this.players = savedPlayers;
        this.actualResults = savedActual;
        this.adminMode = savedAdmin;

        // Count completed rounds
        let totalPicked = 0;
        for (let r = 0; r < 6; r++) {
            totalPicked += Object.keys(results[r] || {}).length;
        }

        // Find champion
        const championId = results[5]?.[0];
        const champion = championId ? players.find(p => p.id === championId) : null;

        const statusHtml = champion
            ? `<div class="live-champion-banner">🏆 Champion: ${UI.escapeHtml(champion.name)}</div>`
            : totalPicked > 0
                ? `<div class="live-progress-info">${totalPicked} of 63 results entered</div>`
                : `<div class="live-progress-info">No results yet — check back once the tournament begins!</div>`;

        const contentEl = document.getElementById('liveBracketContent');
        if (contentEl) {
            contentEl.innerHTML = `
                ${statusHtml}
                <div class="bracket-tree-wrapper">
                    <div class="bracket-visual-area" id="liveBracketVisualArea">
                        ${bracketHtml}
                    </div>
                </div>`;
            this.scheduleBracketRedraw();
        }
    },

    /** Switch live bracket gender and re-render */
    _switchLiveGender(gender) {
        this._liveBracketGender = gender;
        document.body.className = gender === 'women' ? 'women' : '';
        this.renderLiveBracketPage();
    },

    // ── Stats Dashboard ────────────────────────────────────────

    _statsCharts: [],

    async showStats() {
        if (this._warnIfPicking()) return;
        this._closeNav();
        this._navGen++;
        this.currentView = 'stats';
        this._setActiveNav('navStats');
        delete document.body.dataset.intensity;
        this.render();
    },

    /** Render stats page shell with skeleton loading state, then load data */
    renderStatsPage() {
        const container = document.getElementById('gameContainer');
        container.innerHTML = `
            <div class="page-view">
                <div class="ad-slot" id="adStatsTop" style="display:none"></div>
                <h1 class="page-title">TOURNAMENT STATS</h1>
                <div id="statsContent">
                    <div class="skeleton-stat-cards">
                        <div class="skeleton skeleton-stat"></div>
                        <div class="skeleton skeleton-stat"></div>
                        <div class="skeleton skeleton-stat"></div>
                        <div class="skeleton skeleton-stat"></div>
                    </div>
                    <div class="skeleton skeleton-section"></div>
                    <div class="skeleton skeleton-section" style="height:150px"></div>
                </div>
                <div class="ad-slot" id="adStats" style="display:none"></div>
            </div>`;
        this._loadStats();
        this._initPullToRefresh('statsContent', () => this._loadStats());
    },

    /**
     * Load and render all tournament statistics:
     * overview cards, world map, champion picks, controversial matchups,
     * pick popularity, and achievement badges.
     */
    async _loadStats() {
        const content = document.getElementById('statsContent');

        try {
            const [menSnap, womenSnap] = await Promise.all([
                db.collection('brackets-men').get(),
                db.collection('brackets-women').get()
            ]);

            this._statsCharts.forEach(c => c.destroy());
            this._statsCharts = [];

            const menData = this._aggregateStats(menSnap, this.menPlayers);
            const womenData = this._aggregateStats(womenSnap, this.womenPlayers);

            // Load actual results for both genders
            let menActualResults = null, womenActualResults = null;
            try {
                const [menResDoc, womenResDoc] = await Promise.all([
                    db.collection('actualResults-men').doc('current').get(),
                    db.collection('actualResults-women').doc('current').get()
                ]);
                if (menResDoc.exists) menActualResults = menResDoc.data().predictions || null;
                if (womenResDoc.exists) womenActualResults = womenResDoc.data().predictions || null;
            } catch (e) { /* ignore */ }

            let html = '';

            // Collect location data
            const locationCounts = {};
            menSnap.forEach(doc => { const loc = doc.data().location; if (loc) locationCounts[loc] = (locationCounts[loc] || 0) + 1; });
            womenSnap.forEach(doc => { const loc = doc.data().location; if (loc) locationCounts[loc] = (locationCounts[loc] || 0) + 1; });
            const countryCount = Object.keys(locationCounts).length;

            // Overview cards
            const total = menSnap.size + womenSnap.size;
            html += `<div class="stat-cards">
                <div class="stat-card">
                    <div class="stat-number">${total}</div>
                    <div class="stat-label">Total Brackets</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number">${menSnap.size}</div>
                    <div class="stat-label">Mens Brackets</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number">${womenSnap.size}</div>
                    <div class="stat-label">Womens Brackets</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number">${countryCount}</div>
                    <div class="stat-label">Countries</div>
                </div>
            </div>`;

            // Global map
            html += this._buildGlobalMap(locationCounts);

            // Champion picks tables
            const menActualChampId = menActualResults?.[5]?.[0] || null;
            const womenActualChampId = womenActualResults?.[5]?.[0] || null;
            const menActualChamp = menActualChampId ? this.menPlayers.find(p => p.id === menActualChampId)?.name : null;
            const womenActualChamp = womenActualChampId ? this.womenPlayers.find(p => p.id === womenActualChampId)?.name : null;
            html += `<div class="stats-grid stats-grid-wide">`;
            html += this._buildChampionTable("Mens Champion Picks", menData.champions, menActualChamp);
            html += this._buildChampionTable("Womens Champion Picks", womenData.champions, womenActualChamp);
            html += `</div>`;

            // Most controversial
            html += `<div class="stats-grid stats-grid-wide">`;
            html += this._buildControversial("Mens Most Controversial", menData.controversial, this.menPlayers);
            html += this._buildControversial("Womens Most Controversial", womenData.controversial, this.womenPlayers);
            html += `</div>`;

            // Pick popularity
            html += `<div class="stats-grid">`;
            html += this._buildPickPopularity("Mens Pick Popularity", menData.pickData, this.menPlayers);
            html += this._buildPickPopularity("Womens Pick Popularity", womenData.pickData, this.womenPlayers);
            html += `</div>`;

            // Achievement badges
            html += this._buildAchievements(menSnap, womenSnap, menActualResults, womenActualResults);

            content.innerHTML = html;


        } catch (e) {
            console.error('Error loading stats:', e);
            content.innerHTML = '<p style="text-align:center;color:#f00;">Error loading stats</p>';
        }
    },

    /**
     * Aggregate bracket data for stats: champion picks, per-round pick counts,
     * and most controversial matchup (closest to 50/50 split).
     */
    _aggregateStats(snap, players) {
        const champions = {};
        const pickData = {};
        let mostControversial = null;
        let smallestDiff = Infinity;

        snap.forEach(doc => {
            const preds = doc.data().predictions;
            // Champion picks
            if (preds[5]?.[0]) {
                const champ = players.find(p => p.id === preds[5][0]);
                if (champ) champions[champ.name] = (champions[champ.name] || 0) + 1;
            }
            // Per-round picks
            for (let r = 0; r < 6; r++) {
                if (!preds[r]) continue;
                if (!pickData[r]) pickData[r] = {};
                Object.entries(preds[r]).forEach(([m, pid]) => {
                    if (!pickData[r][m]) pickData[r][m] = {};
                    pickData[r][m][pid] = (pickData[r][m][pid] || 0) + 1;
                });
            }
        });

        // Find most controversial (closest to 50/50)
        for (const r in pickData) {
            for (const m in pickData[r]) {
                const picks = Object.entries(pickData[r][m]);
                if (picks.length === 2) {
                    const total = picks[0][1] + picks[1][1];
                    if (total >= 2) {
                        const pct = picks[0][1] / total;
                        const diff = Math.abs(pct - 0.5);
                        if (diff < smallestDiff) {
                            smallestDiff = diff;
                            mostControversial = {
                                round: parseInt(r),
                                match: parseInt(m),
                                player1: { id: parseInt(picks[0][0]), count: picks[0][1] },
                                player2: { id: parseInt(picks[1][0]), count: picks[1][1] },
                                total
                            };
                        }
                    }
                }
            }
        }

        return {
            champions: Object.entries(champions).sort((a, b) => b[1] - a[1]),
            pickData,
            controversial: mostControversial
        };
    },

    // Country center coordinates (approx lat/lng)
    _countryCoords: {
        'Argentina': [-34, -64], 'Australia': [-25, 134], 'Austria': [47.5, 14],
        'Belgium': [50.8, 4.5], 'Brazil': [-14, -51], 'Canada': [56, -106],
        'Chile': [-35, -71], 'China': [35, 105], 'Colombia': [4, -72],
        'Croatia': [45.1, 15.2], 'Czech Republic': [49.8, 15.5], 'Denmark': [56, 10],
        'Finland': [64, 26], 'France': [46.6, 2.2], 'Germany': [51.2, 10.4],
        'Hong Kong': [22.3, 114.2], 'Hungary': [47.2, 19.5], 'Iceland': [65, -18],
        'India': [21, 78], 'Indonesia': [-5, 120], 'Ireland': [53.4, -8],
        'Israel': [31.5, 35], 'Italy': [42.5, 12.5], 'Japan': [36.2, 138.3],
        'Luxembourg': [49.8, 6.1], 'Malaysia': [4.2, 101.9], 'Mexico': [23.6, -102.5],
        'Netherlands': [52.1, 5.3], 'New Zealand': [-41, 174], 'Norway': [62, 10],
        'Peru': [-10, -76], 'Philippines': [13, 122], 'Poland': [52, 20],
        'Portugal': [39.4, -8], 'Romania': [46, 25], 'Russia': [61, 105],
        'Scotland': [56.5, -4], 'Serbia': [44.2, 20.5], 'Singapore': [1.35, 103.8],
        'South Africa': [-30.6, 25.5], 'South Korea': [36.5, 128], 'Spain': [40, -3.7],
        'Sweden': [62, 15], 'Switzerland': [46.8, 8.2], 'Taiwan': [23.7, 121],
        'Thailand': [15, 101], 'United Kingdom': [54, -2], 'United States': [38, -97],
        'Other': [0, 0]
    },

    /**
     * Build an SVG world map showing bracket submission locations.
     * Uses equirectangular projection with approximate country coordinates.
     * Dot size and opacity scale with submission count.
     */
    _buildGlobalMap(locationCounts) {
        const entries = Object.entries(locationCounts).filter(([c]) => c !== 'Other' && this._countryCoords[c]);
        const otherCount = locationCounts['Other'] || 0;
        if (entries.length === 0 && otherCount === 0) {
            return `<div class="stat-section" style="margin-bottom:24px;"><h3 class="stat-section-title">Global Submissions</h3>
                <p style="text-align:center;color:rgba(255,255,255,0.4);padding:20px;">No location data yet</p></div>`;
        }

        const maxCount = Math.max(...entries.map(([, c]) => c), 1);
        const W = 800, H = 400;

        // Equirectangular projection
        const toXY = (lat, lng) => {
            const x = ((lng + 180) / 360) * W;
            const y = ((90 - lat) / 180) * H;
            return [x, y];
        };

        let dots = '';
        const sortedEntries = entries.sort((a, b) => a[1] - b[1]); // draw smaller on top of larger
        sortedEntries.forEach(([country, count]) => {
            const [lat, lng] = this._countryCoords[country];
            const [x, y] = toXY(lat, lng);
            const r = 4 + (count / maxCount) * 14;
            const opacity = 0.5 + (count / maxCount) * 0.5;
            dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="var(--kendo-gold)" opacity="${opacity.toFixed(2)}" class="map-dot">`;
            dots += `<title>${UI.escapeHtml(country)}: ${count} bracket${count !== 1 ? 's' : ''}</title></circle>`;
        });

        // Build legend
        const legend = sortedEntries.sort((a, b) => b[1] - a[1]).map(([country, count]) =>
            `<span class="map-legend-item"><span class="map-legend-dot"></span>${UI.escapeHtml(country)} (${count})</span>`
        ).join('');
        const otherHtml = otherCount > 0 ? `<span class="map-legend-item"><span class="map-legend-dot" style="opacity:0.5"></span>Other (${otherCount})</span>` : '';

        return `<div class="stat-section global-map-section">
            <h3 class="stat-section-title">Global Submissions</h3>
            <div class="global-map-wrap">
                <svg viewBox="0 0 ${W} ${H}" class="global-map-svg" xmlns="http://www.w3.org/2000/svg">
                    <!-- Simplified continent outlines -->
                    <rect width="${W}" height="${H}" fill="transparent"/>
                    <!-- Grid lines -->
                    <line x1="0" y1="${H/2}" x2="${W}" y2="${H/2}" stroke="rgba(255,255,255,0.06)" stroke-dasharray="4,4"/>
                    <line x1="${W/2}" y1="0" x2="${W/2}" y2="${H}" stroke="rgba(255,255,255,0.06)" stroke-dasharray="4,4"/>
                    <line x1="0" y1="${H*0.25}" x2="${W}" y2="${H*0.25}" stroke="rgba(255,255,255,0.03)" stroke-dasharray="2,6"/>
                    <line x1="0" y1="${H*0.75}" x2="${W}" y2="${H*0.75}" stroke="rgba(255,255,255,0.03)" stroke-dasharray="2,6"/>
                    <!-- Continent shapes (simplified) -->
                    <path d="M120,80 Q140,70 160,75 L175,90 Q185,110 180,140 L170,170 Q165,185 155,195 L145,200 Q130,210 120,190 L110,170 Q100,150 105,130 L110,110 Q115,90 120,80Z" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)" stroke-width="0.5"/>
                    <path d="M340,55 Q380,50 420,55 L450,60 Q480,65 500,80 L510,100 Q515,120 500,130 L480,125 Q450,115 420,120 L400,130 Q380,140 360,130 L345,110 Q335,85 340,55Z" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)" stroke-width="0.5"/>
                    <path d="M520,65 Q560,50 620,55 L680,70 Q720,80 740,100 L750,130 Q745,150 730,170 L710,190 Q680,210 650,200 L620,210 Q580,225 560,210 L540,190 Q520,165 515,140 L510,120 Q510,90 520,65Z" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)" stroke-width="0.5"/>
                    <path d="M350,140 Q370,135 390,145 L410,165 Q420,190 410,220 L400,260 Q385,290 370,310 L360,320 Q345,335 340,310 L335,280 Q330,250 335,220 L340,190 Q345,160 350,140Z" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)" stroke-width="0.5"/>
                    <path d="M190,230 Q210,200 240,195 L280,200 Q320,210 340,235 L350,260 Q355,290 340,310 L310,335 Q270,360 230,345 L205,320 Q185,290 185,260 L190,230Z" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)" stroke-width="0.5"/>
                    <path d="M600,220 Q640,200 680,215 L720,235 Q740,260 730,290 L710,310 Q680,330 650,325 L620,310 Q595,290 590,265 L595,240 Q595,225 600,220Z" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)" stroke-width="0.5"/>
                    <path d="M690,110 Q710,95 740,100 L760,115 Q770,135 760,155 L740,165 Q720,170 705,160 L695,145 Q685,125 690,110Z" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)" stroke-width="0.5"/>
                    <!-- Dots -->
                    ${dots}
                </svg>
            </div>
            <div class="map-legend">${legend}${otherHtml}</div>
        </div>`;
    },

    /** Build an HTML table showing champion pick distribution with percentage bars */
    _buildChampionTable(title, champions, actualChampName) {
        if (champions.length === 0 && !actualChampName) {
            return `<div class="stat-section"><h3 class="stat-section-title">${UI.escapeHtml(title)}</h3>
                <p style="text-align:center;color:rgba(255,255,255,0.4);padding:20px;">No picks yet</p></div>`;
        }

        // If actual champion isn't in the list, append with 0 picks
        let champList = [...champions];
        if (actualChampName && !champList.some(([name]) => name === actualChampName)) {
            champList.push([actualChampName, 0]);
        }

        const total = champList.reduce((s, [, c]) => s + c, 0);
        const maxCount = champList.length > 0 && champList[0][1] > 0 ? champList[0][1] : 1;
        const rows = champList.map(([name, count], i) => {
            const pct = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0';
            const barWidth = ((count / maxCount) * 100).toFixed(1);
            const isWinner = actualChampName && name === actualChampName;
            const winnerClass = isWinner ? ' champ-row-winner' : '';
            const trophy = isWinner ? '<span class="champ-trophy" title="Actual Champion">&#x1f3c6;</span> ' : '';
            return `<tr class="champ-row${winnerClass}">
                <td class="champ-rank">${i + 1}</td>
                <td class="champ-name">${trophy}${UI.escapeHtml(name)}</td>
                <td class="champ-count">${count}</td>
                <td class="champ-bar-cell"><div class="champ-bar" style="width:${barWidth}%"></div><span class="champ-pct">${pct}%</span></td>
            </tr>`;
        }).join('');

        return `<div class="stat-section">
            <h3 class="stat-section-title">${UI.escapeHtml(title)}</h3>
            <table class="champ-table">
                <thead><tr><th>#</th><th>Player</th><th>Picks</th><th></th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
    },

    /** Build the "most controversial" matchup card showing the closest to 50/50 split */
    _buildControversial(title, data, players) {
        if (!data) {
            return `<div class="stat-section"><h3 class="stat-section-title">${UI.escapeHtml(title)}</h3>
                <p style="text-align:center;color:rgba(255,255,255,0.4);padding:20px;">Not enough data</p></div>`;
        }

        const p1 = players.find(p => p.id === data.player1.id);
        const p2 = players.find(p => p.id === data.player2.id);
        const p1Pct = Math.round((data.player1.count / data.total) * 100);
        const p2Pct = 100 - p1Pct;
        const goldColor = 'var(--kendo-gold)';
        const blueColor = 'rgba(102, 126, 234, 0.8)';
        const p1BarColor = p1Pct >= p2Pct ? goldColor : blueColor;
        const p2BarColor = p1Pct >= p2Pct ? blueColor : goldColor;

        return `<div class="stat-section">
            <h3 class="stat-section-title">${UI.escapeHtml(title)}</h3>
            <div class="controversial-card">
                <div class="controversial-round">${ROUND_NAMES[data.round]}</div>
                <div class="controversial-matchup">
                    <div class="controversial-player">
                        <span class="controversial-name">${UI.escapeHtml(p1?.name || '?')}</span>
                        <span class="controversial-pct" style="color:${p1BarColor}">${p1Pct}%</span>
                    </div>
                    <div class="controversial-bar">
                        <div class="controversial-fill-left" style="width:${p1Pct}%;background:${p1BarColor}"></div>
                        <div class="controversial-fill-right" style="width:${p2Pct}%;background:${p2BarColor}"></div>
                    </div>
                    <div class="controversial-player" style="text-align:right;">
                        <span class="controversial-name">${UI.escapeHtml(p2?.name || '?')}</span>
                        <span class="controversial-pct" style="color:${p2BarColor}">${p2Pct}%</span>
                    </div>
                </div>
                <div class="controversial-total">${data.total} total picks</div>
            </div>
        </div>`;
    },

    _renderBarChart(canvasId, champions, gender) {
        const canvas = document.getElementById(canvasId);
        if (!canvas || champions.length === 0) return;

        const top = champions.slice(0, 8);
        const labels = top.map(([name]) => name);
        const data = top.map(([, count]) => count);
        const total = champions.reduce((s, [, c]) => s + c, 0);

        // Generate gradient shades: darkest at top, lighter at bottom
        const bgColors = top.map((_, i) => {
            const t = i / Math.max(top.length - 1, 1);
            if (gender === 'women') {
                // Pink shades: from vibrant to soft
                const r = Math.round(236 - t * 60);
                const g = Math.round(72 + t * 80);
                const b = Math.round(153 + t * 40);
                return `rgba(${r}, ${g}, ${b}, 0.7)`;
            } else {
                // Blue shades: from vibrant to soft
                const r = Math.round(102 - t * 40);
                const g = Math.round(126 - t * 20);
                const b = Math.round(234 - t * 50);
                return `rgba(${r}, ${g}, ${b}, 0.7)`;
            }
        });

        const borderColors = bgColors.map(c => c.replace('0.7)', '1)'));

        const chart = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    data,
                    backgroundColor: bgColors,
                    borderColor: borderColors,
                    borderWidth: 1,
                    borderRadius: 4
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label(ctx) {
                                const pct = ((ctx.parsed.x / total) * 100).toFixed(1);
                                return `${ctx.parsed.x} picks (${pct}%)`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255,255,255,0.06)' },
                        ticks: { color: 'rgba(255,255,255,0.5)', font: { size: 10 } }
                    },
                    y: {
                        grid: { display: false },
                        ticks: { color: 'rgba(255,255,255,0.7)', font: { size: 11 } }
                    }
                }
            }
        });
        this._statsCharts.push(chart);
    },

    /** Build expandable pick popularity sections showing per-match pick distributions */
    _buildPickPopularity(title, pickData, players) {
        if (!pickData || Object.keys(pickData).length === 0) return '';

        let html = `<div class="stat-section"><h3 class="stat-section-title">${UI.escapeHtml(title)}</h3>`;

        for (let r = 0; r < 6; r++) {
            if (!pickData[r]) continue;
            html += `<details class="popularity-details"><summary>${ROUND_NAMES[r]}</summary><div class="popularity-grid">`;

            const sortedMatches = Object.entries(pickData[r]).sort((a, b) => Number(a[0]) - Number(b[0]));
            sortedMatches.forEach(([m, picks]) => {
                const sorted = Object.entries(picks).sort((a, b) => b[1] - a[1]);
                const total = sorted.reduce((s, [, c]) => s + c, 0);
                const maxPct = total > 0 ? Math.round((sorted[0][1] / total) * 100) : 0;
                const pickHtml = sorted.map(([pid, count], idx) => {
                    const player = players.find(p => p.id === Number(pid));
                    const name = player ? player.name : 'Unknown';
                    const pct = Math.round((count / total) * 100);
                    const barClass = idx === 0 ? 'popularity-bar-top' : 'popularity-bar-other';
                    const barWidth = Math.max(pct, 2);
                    return `<div class="popularity-bar-row">
                        <span class="popularity-name">${UI.escapeHtml(name)}</span>
                        <div class="popularity-bar-bg"><div class="popularity-bar-fill ${barClass}" style="width:${barWidth}%"></div></div>
                        <span class="popularity-pct">${pct}%</span>
                    </div>`;
                }).join('');
                html += `<div class="popularity-match">${pickHtml}</div>`;
            });

            html += `</div></details>`;
        }

        html += `</div>`;
        return html;
    },

    closeStatsModal() {
        document.getElementById('statsModal').style.display = 'none';
        unlockBodyScroll();
    },

    // ── Bracket Similarity ──────────────────────────────────────

    /** Calculate how often the user's picks match the most popular choice per matchup */
    _calcBracketSimilarity(userBracket, pickData) {
        if (!pickData || !userBracket) return null;
        let matches = 0, agrees = 0;
        for (let r = 0; r < 6; r++) {
            if (!pickData[r]) continue;
            Object.entries(pickData[r]).forEach(([m, picks]) => {
                const userPick = userBracket[r]?.[m];
                if (!userPick) return;
                matches++;
                const sorted = Object.entries(picks).sort((a, b) => b[1] - a[1]);
                if (sorted.length > 0 && Number(sorted[0][0]) === userPick) agrees++;
            });
        }
        return matches > 0 ? Math.round((agrees / matches) * 100) : null;
    },

    // ── Survival Tracker ────────────────────────────────────────

    _buildSurvivalTracker(title, snap, gender, actualResults) {
        let champAlive = 0, perfectPath = 0, totalBrackets = 0;

        if (!actualResults) {
            return `<div class="stat-section"><h3 class="stat-section-title">${UI.escapeHtml(title)}</h3>
                <p style="text-align:center;color:rgba(255,255,255,0.4);padding:20px;">Results not entered yet</p></div>`;
        }

        const totalActual = Object.values(actualResults).reduce((s, r) => s + Object.keys(r).length, 0);
        if (totalActual === 0) {
            return `<div class="stat-section"><h3 class="stat-section-title">${UI.escapeHtml(title)}</h3>
                <p style="text-align:center;color:rgba(255,255,255,0.4);padding:20px;">Results not entered yet</p></div>`;
        }

        // Find actual champion (if finals result exists)
        const actualChampion = actualResults[5]?.[0] || null;

        snap.forEach(doc => {
            const preds = doc.data().predictions;
            if (!preds) return;
            totalBrackets++;

            // Check if their champion is still alive
            const userChampion = preds[5]?.[0];
            if (userChampion && actualChampion) {
                if (userChampion === actualChampion) champAlive++;
            } else if (userChampion) {
                // Check if user's champion hasn't been eliminated yet
                let eliminated = false;
                for (let r = 0; r < 6; r++) {
                    const actual = actualResults[r] || {};
                    Object.entries(actual).forEach(([m, winnerId]) => {
                        const matchIdx = Number(m);
                        // Check if this player was in this match and lost
                        if (r === 0) {
                            const players = gender === 'men' ? this.menPlayers : this.womenPlayers;
                            const p1 = players[matchIdx * 2]?.id;
                            const p2 = players[matchIdx * 2 + 1]?.id;
                            if ((userChampion === p1 || userChampion === p2) && winnerId !== userChampion) eliminated = true;
                        }
                    });
                }
                if (!eliminated) champAlive++;
            }

            // Check perfect path
            let perfect = true;
            for (let r = 0; r < 6; r++) {
                const actual = actualResults[r] || {};
                const picks = preds[r] || {};
                Object.keys(actual).forEach(m => {
                    if (picks[m] !== actual[m]) perfect = false;
                });
            }
            if (perfect && totalActual > 0) perfectPath++;
        });

        return `<div class="stat-section">
            <h3 class="stat-section-title">${UI.escapeHtml(title)}</h3>
            <div style="display:flex;gap:16px;justify-content:center;">
                <div style="text-align:center;">
                    <div style="font-family:'Bebas Neue',sans-serif;font-size:2em;color:var(--kendo-gold);">${champAlive}</div>
                    <div style="font-family:'Bebas Neue',sans-serif;font-size:0.65em;letter-spacing:2px;color:rgba(255,255,255,0.35);">CHAMPION ALIVE</div>
                </div>
                <div style="text-align:center;">
                    <div style="font-family:'Bebas Neue',sans-serif;font-size:2em;color:var(--kendo-gold);">${perfectPath}</div>
                    <div style="font-family:'Bebas Neue',sans-serif;font-size:0.65em;letter-spacing:2px;color:rgba(255,255,255,0.35);">PERFECT PATH</div>
                </div>
                <div style="text-align:center;">
                    <div style="font-family:'Bebas Neue',sans-serif;font-size:2em;color:white;">${totalBrackets}</div>
                    <div style="font-family:'Bebas Neue',sans-serif;font-size:0.65em;letter-spacing:2px;color:rgba(255,255,255,0.35);">TOTAL BRACKETS</div>
                </div>
            </div>
        </div>`;
    },

    // ── Achievement Badges ──────────────────────────────────────

    /** Build achievement badges: Early Bird, Contrarian, Upset Caller, Oracle */
    _buildAchievements(menSnap, womenSnap, menActualResults, womenActualResults) {
        const allDocs = [];
        menSnap.forEach(doc => allDocs.push({ ...doc.data(), uid: doc.id, gender: 'men' }));
        womenSnap.forEach(doc => allDocs.push({ ...doc.data(), uid: doc.id, gender: 'women' }));

        if (allDocs.length === 0) return '';

        // Early Bird: first 10 submissions by timestamp
        const withTime = allDocs.filter(d => d.timestamp).sort((a, b) => {
            const at = a.timestamp.seconds || 0;
            const bt = b.timestamp.seconds || 0;
            return at - bt;
        });
        const earlyBirds = withTime.slice(0, Math.min(10, withTime.length)).map(d => d.displayName || 'Anonymous');

        // Contrarian: bracket most different from crowd consensus
        // Build consensus per gender
        let maxDiff = 0, contrarianName = '';
        ['men', 'women'].forEach(gender => {
            const genderDocs = allDocs.filter(d => d.gender === gender && d.predictions);
            if (genderDocs.length < 2) return;
            // Build consensus
            const consensus = {};
            genderDocs.forEach(d => {
                for (let r = 0; r < 6; r++) {
                    if (!d.predictions[r]) continue;
                    if (!consensus[r]) consensus[r] = {};
                    Object.entries(d.predictions[r]).forEach(([m, pid]) => {
                        if (!consensus[r][m]) consensus[r][m] = {};
                        consensus[r][m][pid] = (consensus[r][m][pid] || 0) + 1;
                    });
                }
            });
            // Find most popular per matchup
            const popular = {};
            Object.entries(consensus).forEach(([r, matches]) => {
                popular[r] = {};
                Object.entries(matches).forEach(([m, picks]) => {
                    const top = Object.entries(picks).sort((a, b) => b[1] - a[1])[0];
                    if (top) popular[r][m] = Number(top[0]);
                });
            });
            // Score each bracket
            genderDocs.forEach(d => {
                let differ = 0, total = 0;
                for (let r = 0; r < 6; r++) {
                    if (!popular[r] || !d.predictions[r]) continue;
                    Object.entries(popular[r]).forEach(([m, popPick]) => {
                        total++;
                        if (d.predictions[r][m] !== popPick) differ++;
                    });
                }
                if (total > 0 && differ > maxDiff) {
                    maxDiff = differ;
                    contrarianName = d.displayName || 'Anonymous';
                }
            });
        });

        // Upset Caller: most correctly predicted upsets (lower seed beating higher seed)
        let upsetCallerName = '', upsetCallerCount = 0;
        [{ gender: 'men', results: menActualResults, players: this.menPlayers },
         { gender: 'women', results: womenActualResults, players: this.womenPlayers }].forEach(({ gender, results: actualResults, players: pList }) => {
            if (!actualResults) return;
            const genderDocs = allDocs.filter(d => d.gender === gender && d.predictions);
            genderDocs.forEach(d => {
                let upsets = 0;
                for (let r = 0; r < 6; r++) {
                    const actual = actualResults[r] || {};
                    const picks = d.predictions[r] || {};
                    Object.entries(actual).forEach(([m, winnerId]) => {
                        if (picks[m] !== winnerId) return;
                        // Determine if this was an upset: winner had higher id (lower seed)
                        const matchIdx = Number(m);
                        const matchSize = Math.pow(2, 6 - r);
                        const p1Seed = matchIdx * 2;
                        const p2Seed = matchIdx * 2 + 1;
                        // Find who was in this match based on round 0 seeding
                        // Simpler: higher player id = lower seed = upset if they won
                        const loserId = this._getOpponentInMatch(d.predictions, r, matchIdx, winnerId, pList);
                        if (loserId && winnerId > loserId) upsets++;
                    });
                }
                if (upsets > upsetCallerCount) {
                    upsetCallerCount = upsets;
                    upsetCallerName = d.displayName || 'Anonymous';
                }
            });
        });

        // Oracle: correctly predicted the champion
        const oracleNames = [];
        [{ gender: 'men', results: menActualResults },
         { gender: 'women', results: womenActualResults }].forEach(({ gender, results: actualResults }) => {
            if (!actualResults || !actualResults[5] || !actualResults[5][0]) return;
            const champId = actualResults[5][0];
            const genderDocs = allDocs.filter(d => d.gender === gender && d.predictions);
            genderDocs.forEach(d => {
                if (d.predictions[5] && d.predictions[5][0] === champId) {
                    const name = d.displayName || 'Anonymous';
                    if (!oracleNames.includes(name)) oracleNames.push(name);
                }
            });
        });

        let html = `<div class="stat-section" style="margin-top:20px;">
            <h3 class="stat-section-title">ACHIEVEMENT BADGES</h3>
            <div class="badge-grid">`;

        // Early Bird
        html += `<div class="badge-card">
            <div class="badge-icon">🐦</div>
            <div class="badge-title">EARLY BIRD</div>
            <div class="badge-desc">First ${earlyBirds.length} to submit</div>
            <div class="badge-names">${earlyBirds.map(n => UI.escapeHtml(n)).join(', ')}</div>
        </div>`;

        // Contrarian
        if (contrarianName) {
            html += `<div class="badge-card">
                <div class="badge-icon">🎭</div>
                <div class="badge-title">CONTRARIAN</div>
                <div class="badge-desc">Most unique picks</div>
                <div class="badge-names">${UI.escapeHtml(contrarianName)}</div>
            </div>`;
        }

        // Upset Caller
        if (upsetCallerName && upsetCallerCount > 0) {
            html += `<div class="badge-card">
                <div class="badge-icon">🎯</div>
                <div class="badge-title">UPSET CALLER</div>
                <div class="badge-desc">Most correct upset predictions (${upsetCallerCount})</div>
                <div class="badge-names">${UI.escapeHtml(upsetCallerName)}</div>
            </div>`;
        }

        // Oracle
        if (oracleNames.length > 0) {
            html += `<div class="badge-card">
                <div class="badge-icon">🔮</div>
                <div class="badge-title">ORACLE</div>
                <div class="badge-desc">Correctly predicted the champion</div>
                <div class="badge-names">${oracleNames.map(n => UI.escapeHtml(n)).join(', ')}</div>
            </div>`;
        }

        html += `</div></div>`;
        return html;
    },

    /** Find the opponent of a winner in a given match (for upset detection) */
    _getOpponentInMatch(predictions, round, matchIdx, winnerId, players) {
        // For round 0, the two players are seeded: matchIdx*2 + 1 and matchIdx*2 + 2
        if (round === 0) {
            const p1Id = matchIdx * 2 + 1;
            const p2Id = matchIdx * 2 + 2;
            return winnerId === p1Id ? p2Id : p1Id;
        }
        // For later rounds, look at the previous round's picks that feed into this match
        const prevRound = predictions[round - 1];
        if (!prevRound) return null;
        const feedMatch1 = matchIdx * 2;
        const feedMatch2 = matchIdx * 2 + 1;
        const p1Id = prevRound[feedMatch1];
        const p2Id = prevRound[feedMatch2];
        if (!p1Id || !p2Id) return null;
        return winnerId === p1Id ? p2Id : p1Id;
    },

    // ── Scoring Rules ───────────────────────────────────────────

    showScoringRules() {
        this._closeNav();
        document.getElementById('scoringRulesModal').style.display = 'block';
        lockBodyScroll();
    },

    closeScoringRules() {
        document.getElementById('scoringRulesModal').style.display = 'none';
        unlockBodyScroll();
    },

    // ── FAQ ─────────────────────────────────────────────────────

    showFaq() {
        this._closeNav();
        this._navGen++;
        this.currentView = 'faq';
        this._setActiveNav('navFaq');
        delete document.body.dataset.intensity;
        document.getElementById('landingPage').style.display = 'none';
        document.getElementById('mainApp').style.display = 'block';
        this.render();
    },

    /** Render the FAQ page with expandable question/answer sections */
    renderFaqPage() {
        const sections = [
            {
                title: 'ABOUT',
                items: [
                    {
                        q: 'What is Kendo?',
                        a: 'Kendo (\u5263\u9053) is the Japanese martial art of sword fighting. Practitioners wear protective armor (bogu) and use bamboo swords (shinai) to strike designated target areas. It emphasizes discipline, respect, and the pursuit of personal development through rigorous training.'
                    },
                    {
                        q: 'What is the AJKC?',
                        a: 'The All Japan Kendo Championship (\u5168\u65e5\u672c\u5263\u9053\u9078\u624b\u6a29\u5927\u4f1a) is the most prestigious individual kendo tournament in Japan, held annually since 1953. Each prefecture sends its top representatives to compete in a single-elimination bracket. The tournament features both a men\'s and women\'s division.'
                    },
                    {
                        q: 'What is AJKC Anarchy?',
                        a: [
                            'AJKC Anarchy is a passion project built for the kendo community. It\'s a free bracket prediction game where you pick winners for every match of the All Japan Kendo Championship and compete against fans from around the world.',
                            'It was born from a simple obsession \u2014 the AJKC is my Super Bowl, my World Cup. I have always loved studying the matchups and trying to predict who would win it all that year. Inspired by March Madness-style brackets, I built this as a way for kendo fans everywhere to compete, connect, and share the same excitement that I do.'
                        ]
                    }
                ]
            },
            {
                title: 'HOW IT WORKS',
                items: [
                    {
                        q: 'How do I play?',
                        a: 'Select either the Men\'s or Women\'s bracket, then pick a winner for each matchup from the Round of 64 through the Finals. Submit your bracket before the tournament starts to lock in your picks.'
                    },
                    {
                        q: 'Is it free?',
                        a: 'Yes! AJKC Anarchy is completely free to play. No purchase or sign-up is required to fill out a bracket, though signing in helps save your picks.'
                    },
                    {
                        q: 'Can I fill out both men\'s and women\'s brackets?',
                        a: 'Yes! You can submit a bracket for both the Men\'s and Women\'s championships. They are scored independently.'
                    },
                    {
                        q: 'Can I edit my bracket after submitting?',
                        a: 'Yes, you can edit your bracket as many times as you want before the tournament starts. Once it locks, your most recent submission is final.'
                    },
                    {
                        q: 'When does the bracket lock?',
                        a: 'Brackets automatically lock when the tournament begins. After that, no edits or new submissions are accepted.'
                    }
                ]
            },
            {
                title: 'SCORING',
                items: [
                    {
                        q: 'How is scoring calculated?',
                        a: 'Points increase each round: 1 pt (R64), 2 pts (R32), 4 pts (R16), 8 pts (QF), 16 pts (SF), 32 pts (Finals). You also earn +1 per correct pick, +5 for predicting the final ippon, and +50 for a perfect bracket.'
                    },
                    {
                        q: 'What is the ippon bonus?',
                        a: 'If you correctly predict the winning technique (men, kote, do, tsuki, or hansoku) of the final match, you earn an extra 5 points.'
                    },
                    {
                        q: 'How are ties broken?',
                        a: 'If two players have the same score, the tiebreaker goes to whoever submitted their bracket earlier.'
                    }
                ]
            },
            {
                title: 'ACCOUNT',
                items: [
                    {
                        q: 'Do I need an account?',
                        a: 'You can fill out a bracket without an account, but signing in with Google or email ensures your bracket is saved across devices and won\'t be lost if you clear your browser data.'
                    },
                    {
                        q: 'Who made this?',
                        a: 'Just another fellow kendo nerd practicing in the USA. Check out my content on Instagram, Youtube, and TikTok! If you enjoy it, consider supporting me on the Donate page!'
                    }
                ]
            }
        ];

        const html = sections.map(section => {
            const items = section.items.map(({ q, a }) => {
                const answerHtml = Array.isArray(a)
                    ? a.map(p => `<p>${UI.escapeHtml(p)}</p>`).join('')
                    : `<p>${UI.escapeHtml(a)}</p>`;
                return `
                <details class="faq-item">
                    <summary class="faq-question">${UI.escapeHtml(q)}</summary>
                    <div class="faq-answer">${answerHtml}</div>
                </details>`;
            }).join('');
            return `<div class="faq-section">
                <h2 class="faq-section-title">${UI.escapeHtml(section.title)}</h2>
                ${items}
            </div>`;
        }).join('');

        document.getElementById('gameContainer').innerHTML = `
            <div class="page-view">
                <h1 class="page-title">FREQUENTLY ASKED QUESTIONS</h1>
                <div class="faq-list">${html}</div>
            </div>`;
        window.scrollTo(0, 0);
    },

    showDonateModal() {
        this._closeNav();
        this._navGen++;
        this.currentView = 'donate';
        this._setActiveNav('navDonate');
        delete document.body.dataset.intensity;
        document.getElementById('landingPage').style.display = 'none';
        document.getElementById('mainApp').style.display = 'block';
        this.render();
    },

    async showLandingStats() {
        this._navGen++;
        this.currentView = 'stats';
        this._setActiveNav('navStats');
        delete document.body.dataset.intensity;
        document.getElementById('gameContainer').innerHTML = '';
        document.getElementById('landingPage').style.display = 'none';
        document.getElementById('mainApp').style.display = 'block';
        window.scrollTo(0, 0);
        this.renderStatsPage();
        await this.checkLockStatus();
        await this.loadActualResults();
        await this.updateBracketCount();
    },

    async showLandingAllBrackets() {
        this._navGen++;
        this.currentView = 'allBrackets';
        this._setActiveNav('navAllBrackets');
        delete document.body.dataset.intensity;
        document.getElementById('gameContainer').innerHTML = '';
        document.getElementById('landingPage').style.display = 'none';
        document.getElementById('mainApp').style.display = 'block';
        window.scrollTo(0, 0);
        this.renderAllBracketsPage();
        await this.checkLockStatus();
        await this.loadActualResults();
        await this.updateBracketCount();
    },

    async showLandingMyBracket() {
        document.querySelector('.landing-nav-links')?.classList.remove('landing-nav-open');
        this._navGen++;
        const navGen = this._navGen;
        this.currentView = 'bracket';
        this.viewingOtherBracket = false;
        UI.showBackToMine(false);
        this._setActiveNav('navMyBracket');
        delete document.body.dataset.intensity;
        document.getElementById('gameContainer').innerHTML = '';
        document.getElementById('landingPage').style.display = 'none';
        document.getElementById('mainApp').style.display = 'block';
        window.scrollTo(0, 0);
        await this.checkLockStatus();
        if (navGen !== this._navGen) return;
        await this.loadActualResults();
        if (navGen !== this._navGen) return;
        if (this.userBracketData) {
            this.bracket = { ...this.userBracketData };
            this.gameState = this.isBracketComplete() ? 'bracket-summary' : 'picking';
            if (this.gameState === 'picking') this.findFirstIncompleteMatch();
        } else {
            this.bracket = {};
            this.gameState = 'picking';
            this.gameRound = 0;
            this.gameMatch = 0;
        }
        this.render();
        await this.updateBracketCount();
    },

    async showLandingLeaderboard() {
        this._navGen++;
        this.currentView = 'leaderboard';
        this._lbGender = this.currentGender;
        this._setActiveNav('navLeaderboard');
        delete document.body.dataset.intensity;
        // Render before showing to prevent flash
        document.getElementById('gameContainer').innerHTML = '';
        document.getElementById('landingPage').style.display = 'none';
        document.getElementById('mainApp').style.display = 'block';
        window.scrollTo(0, 0);
        this.renderLeaderboardPage();
        await this.checkLockStatus();
        await this.loadActualResults();
        await this.updateBracketCount();
    },

    closeDonateModal() {
        this.goHome();
    },

    /** Render the donate page with tier options and custom amount input */
    renderDonatePage() {
        const container = document.getElementById('gameContainer');
        container.innerHTML = `
            <div class="page-view donate-page">
                <div class="donate-header">
                    <h1 class="donate-title">SUPPORT AJKC ANARCHY</h1>
                    <p class="donate-intro">If you\u2019ve enjoyed using the bracket or want to support future improvements, your contribution helps keep the platform running and growing.</p>
                </div>

                <div class="donate-why">
                    <h2 class="donate-why-title">Every donation goes toward</h2>
                    <div class="donate-why-grid">
                        <div class="donate-why-item">
                            <span class="donate-why-icon">\ud83d\udcbb</span>
                            <p>Improving the website experience</p>
                        </div>
                        <div class="donate-why-item">
                            <span class="donate-why-icon">\u2728</span>
                            <p>Creating more kendo related projects</p>
                        </div>
                        <div class="donate-why-item">
                            <span class="donate-why-icon">\ud83e\udd3a</span>
                            <p>Supporting my kendo training and competitions</p>
                        </div>
                    </div>
                </div>

                <div class="donate-tiers">
                    <h2 class="donate-tiers-title">Choose Your Support</h2>
                    <div class="donate-tiers-grid">
                        <div class="donate-tier" onclick="app._selectDonateTier(3)">
                            <div class="donate-tier-amount">$3</div>
                            <div class="donate-tier-btns">
                                <a href="https://paypal.me/BettyPark259/3" target="_blank" rel="noopener" class="donate-tier-link" onclick="event.stopPropagation()">PAYPAL</a>
                                <a href="https://venmo.com/bparkyy?txn=pay&amount=3&note=AJKC+Anarchy" target="_blank" rel="noopener" class="donate-tier-link donate-tier-link-gold" onclick="event.stopPropagation()">VENMO</a>
                            </div>
                        </div>
                        <div class="donate-tier donate-tier-featured" onclick="app._selectDonateTier(10)">
                            <div class="donate-tier-badge">MOST POPULAR</div>
                            <div class="donate-tier-amount">$10</div>
                            <div class="donate-tier-btns">
                                <a href="https://paypal.me/BettyPark259/10" target="_blank" rel="noopener" class="donate-tier-link" onclick="event.stopPropagation()">PAYPAL</a>
                                <a href="https://venmo.com/bparkyy?txn=pay&amount=10&note=AJKC+Anarchy" target="_blank" rel="noopener" class="donate-tier-link donate-tier-link-gold" onclick="event.stopPropagation()">VENMO</a>
                            </div>
                        </div>
                        <div class="donate-tier" onclick="app._selectDonateTier(25)">
                            <div class="donate-tier-amount">$25</div>
                            <div class="donate-tier-btns">
                                <a href="https://paypal.me/BettyPark259/25" target="_blank" rel="noopener" class="donate-tier-link" onclick="event.stopPropagation()">PAYPAL</a>
                                <a href="https://venmo.com/bparkyy?txn=pay&amount=25&note=AJKC+Anarchy" target="_blank" rel="noopener" class="donate-tier-link donate-tier-link-gold" onclick="event.stopPropagation()">VENMO</a>
                            </div>
                        </div>
                    </div>
                    <div class="donate-custom">
                        <p class="donate-custom-label">OR ENTER CUSTOM AMOUNT</p>
                        <div class="donate-custom-row">
                            <div class="donate-custom-input-wrap">
                                <span class="donate-custom-dollar">$</span>
                                <input type="number" id="donateCustomAmount" class="donate-custom-input" placeholder="0" min="1" step="1" />
                            </div>
                            <a id="donateCustomPaypal" href="https://paypal.me/BettyPark259" target="_blank" rel="noopener" class="donate-tier-link" onclick="app._updateCustomLinks()">PAYPAL</a>
                            <a id="donateCustomVenmo" href="https://venmo.com/bparkyy" target="_blank" rel="noopener" class="donate-tier-link donate-tier-link-gold" onclick="app._updateCustomLinks()">VENMO</a>
                        </div>
                    </div>
                </div>

                <p class="donate-thanks">Thank you for being part of this \ud83d\ude4f</p>
            </div>`;
        // Update custom links when amount changes
        const input = document.getElementById('donateCustomAmount');
        if (input) {
            input.addEventListener('input', () => this._updateCustomLinks());
        }
        window.scrollTo(0, 0);
    },

    _selectDonateTier(amount) {
        // Visual feedback — could expand in the future
    },

    _updateCustomLinks() {
        const input = document.getElementById('donateCustomAmount');
        const amount = parseInt(input?.value) || '';
        const ppLink = document.getElementById('donateCustomPaypal');
        const vmLink = document.getElementById('donateCustomVenmo');
        if (ppLink) ppLink.href = amount ? `https://paypal.me/BettyPark259/${amount}` : 'https://paypal.me/BettyPark259';
        if (vmLink) vmLink.href = amount ? `https://venmo.com/bparkyy?txn=pay&amount=${amount}&note=AJKC+Anarchy` : 'https://venmo.com/bparkyy';
    },

    // ── Odds toggle ───────────────────────────────────────────

    /** Toggle crowd prediction percentages on/off during bracket picking */
    async toggleOdds() {
        this.showOdds = !this.showOdds;
        if (this.showOdds && !this._oddsCache) {
            await this._loadOdds();
        }
        this.render();
    },

    /** Load all brackets and build a per-round, per-match pick count cache for odds display */
    async _loadOdds() {
        try {
            const snap = await db.collection('brackets-' + this.currentGender).get();
            const cache = {};
            snap.forEach(doc => {
                const preds = doc.data().predictions;
                for (let r = 0; r < 6; r++) {
                    if (!preds[r]) continue;
                    if (!cache[r]) cache[r] = {};
                    Object.entries(preds[r]).forEach(([m, playerId]) => {
                        if (!cache[r][m]) cache[r][m] = {};
                        cache[r][m][playerId] = (cache[r][m][playerId] || 0) + 1;
                    });
                }
            });
            this._oddsCache = cache;
        } catch (e) {
            console.error('Error loading odds:', e);
        }
    },
};

// ── Bootstrap ───────────────────────────────────────────────────

auth.onAuthStateChanged(user => app.onAuth(user));
app.ensureAnonymousAuth();
app.completeEmailSignIn();
app.init();

// Warn before closing tab if unsaved picks
window.addEventListener('beforeunload', (e) => {
    if (!app.viewingOtherBracket && app.hasAnyPicks() && !app.userBracketData) {
        e.preventDefault();
        e.returnValue = '';
    }
});

window.addEventListener('click', event => {
    if (event.target === document.getElementById('signInModal')) {
        app.closeSignInModal();
    }
    if (event.target === document.getElementById('scoringRulesModal')) {
        app.closeScoringRules();
    }
    // Close menu when clicking outside
    const menu = document.getElementById('menuDropdown');
    const toggle = document.querySelector('.menu-toggle');
    if (menu && !menu.contains(event.target) && event.target !== toggle) {
        menu.classList.remove('open');
    }
});


