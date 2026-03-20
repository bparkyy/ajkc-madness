// Main application logic

const ROUND_NAMES = ['Round of 64', 'Round of 32', 'Round of 16', 'Quarterfinals', 'Semifinals', 'Finals'];
const ROUND_NAMES_SHORT = ['R64', 'R32', 'R16', 'QF', 'SF', 'F'];
const ROUND_NAMES_JP = ['1回戦', '2回戦', '3回戦', '準々決勝', '準決勝', '決勝'];
const ROUND_INTENSITY = [0, 0.15, 0.3, 0.5, 0.75, 1.0]; // 0 = calm, 1 = max drama

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) { console.log(message); return; }
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

const app = {
    players: [],
    menPlayers: [],
    womenPlayers: [],
    bracket: {},
    userBracketData: null,
    adminMode: false,
    isAdmin: false,
    currentUser: null,
    actualResults: null,
    isLocked: false,
    championChart: null,
    currentGender: 'men',
    viewingOtherBracket: false,
    _viewingBracketName: '',

    // Game flow state
    gameState: 'picking',   // 'picking' | 'round-summary' | 'bracket-summary'
    gameRound: 0,
    gameMatch: 0,
    _advanceTimeout: null,

    // ── Initialisation ──────────────────────────────────────────

    // Tournament date — change this to the actual date
    tournamentDate: new Date('2026-11-03T09:00:00+09:00'),

    async init() {
        this.buildPlayerLists();
        this.players = this.menPlayers;
        this.startCountdown();
        this.loadLandingStats();
        this._checkShareLink();
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

    enterBracket(gender) {
        // Hide landing, show app
        document.getElementById('landingPage').style.display = 'none';
        document.getElementById('mainApp').style.display = 'block';

        this.switchGender(gender);
    },

    goHome() {
        if (this.hasAnyPicks() && !this.userBracketData) {
            if (!confirm('You have unsaved picks. Leave anyway?')) return;
        }
        document.getElementById('mainApp').style.display = 'none';
        document.getElementById('landingPage').style.display = 'block';
        this.loadLandingStats();
    },

    buildPlayerLists() {
        this.menPlayers = menPlayersData.map((p, i) => ({ id: i + 1, ...p }));
        this.womenPlayers = womenPlayersData.map((p, i) => ({ id: i + 1, ...p }));
    },

    // ── Authentication ──────────────────────────────────────────

    async ensureAnonymousAuth() {
        if (!auth.currentUser) {
            try { await auth.signInAnonymously(); }
            catch (e) { console.error('Anonymous auth error:', e); }
        }
    },

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

    _updateAccountBtn() {
        const btn = document.getElementById('accountBtn');
        const landingBtn = document.getElementById('landingSignIn');
        const user = this.currentUser;
        const signedIn = user && !user.isAnonymous && user.email;
        if (btn) {
            btn.textContent = signedIn ? '✓' : '👤';
            btn.title = signedIn ? user.email : 'Sign in';
            btn.style.color = signedIn ? 'var(--kendo-gold)' : '';
        }
        if (landingBtn) {
            landingBtn.textContent = signedIn ? 'SIGNED IN' : 'SIGN IN';
        }
    },

    _setActiveNav(id) {
        document.querySelectorAll('.app-nav .nav-link').forEach(btn => btn.classList.remove('active'));
        const el = document.getElementById(id);
        if (el) el.classList.add('active');
    },

    _closeNav() {
        document.querySelector('.app-nav')?.classList.remove('nav-open');
    },

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
    },

    closeSignInModal() {
        document.getElementById('signInModal').style.display = 'none';
    },

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
                    // Clean up old anonymous bracket
                    await db.collection('brackets-' + gender).doc(oldUid).delete();
                }
            }
            // Reload bracket for current gender
            await this.loadUserBracket();
        } catch (e) {
            console.error('Bracket migration error:', e);
        }
    },

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

    async signOut() {
        try {
            await auth.signOut();
            await auth.signInAnonymously();
            this.closeSignInModal();
        } catch (e) {
            console.error('Sign out error:', e);
        }
    },

    async shareBracket() {
        const nameInput = document.getElementById('submitName') || document.getElementById('userName');
        const displayName = nameInput?.value?.trim() || 'My';
        const genderLabel = this.currentGender === 'men' ? "Men's" : "Women's";
        const title = `${displayName}'s ${genderLabel} Bracket`;

        const bracketArea = document.querySelector('.bracket-tree-wrapper');
        if (!bracketArea) {
            showToast('No bracket to share!', 'error');
            return;
        }

        showToast('Generating screenshot...', 'info');

        // Temporarily add title header and footer to the bracket area
        const titleEl = document.createElement('div');
        titleEl.className = 'screenshot-title';
        titleEl.style.cssText = "font-family:'Bebas Neue',sans-serif;font-size:1.8em;color:#d4a843;letter-spacing:3px;text-align:center;margin-bottom:4px;padding-top:8px;";
        titleEl.textContent = title;
        const subtitleEl = document.createElement('div');
        subtitleEl.className = 'screenshot-title';
        subtitleEl.style.cssText = "font-family:'Lexend',sans-serif;font-size:0.7em;color:rgba(255,255,255,0.3);text-align:center;margin-bottom:12px;letter-spacing:1px;";
        subtitleEl.textContent = 'AJKC MADNESS — Bracket Challenge 2026';
        const footerEl = document.createElement('div');
        footerEl.className = 'screenshot-title';
        footerEl.style.cssText = "font-family:'Bebas Neue',sans-serif;font-size:0.8em;color:rgba(255,255,255,0.2);text-align:center;margin-top:12px;padding-bottom:8px;letter-spacing:2px;";
        footerEl.textContent = 'ajkcmadness.com';

        // Insert title at top, footer at bottom
        bracketArea.insertBefore(subtitleEl, bracketArea.firstChild);
        bracketArea.insertBefore(titleEl, bracketArea.firstChild);
        bracketArea.appendChild(footerEl);

        // Redraw SVG lines to match current layout
        this.drawBracketSVG();

        try {
            const canvas = await html2canvas(bracketArea, {
                backgroundColor: '#0d1017',
                scale: 2,
                useCORS: true,
                logging: false,
                scrollX: 0,
                scrollY: -window.scrollY
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
            // Remove temporary elements and redraw SVG
            document.querySelectorAll('.screenshot-title').forEach(el => el.remove());
            this.drawBracketSVG();
        }
    },

    _checkShareLink() {
        const hash = window.location.hash;
        const match = hash.match(/^#bracket\/(men|women)\/(.+)$/);
        if (match) {
            const [, gender, uid] = match;
            window.location.hash = '';
            // Delay to let the app initialize
            setTimeout(() => {
                this.enterBracket(gender);
                setTimeout(() => this.loadSpecificBracket(uid), 500);
            }, 300);
        }
    },

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
    },

    // ── Gender switching ────────────────────────────────────────

    async switchGender(gender) {
        this.currentGender = gender;
        this.players = gender === 'men' ? this.menPlayers : this.womenPlayers;
        this.bracket = {};
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

    async checkLockStatus() {
        try {
            const doc = await db.collection('settings').doc('tournament').get();
            this.isLocked = doc.exists ? (doc.data().locked || false) : false;
            document.getElementById('lockedNotice').style.display = this.isLocked ? 'block' : 'none';
        } catch (e) { console.error('Error checking lock status:', e); }
    },

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

    async loadUserBracket() {
        if (!this.currentUser) return;
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
            this.render();
        } catch (e) { console.error('Error loading user bracket:', e); }
    },

    hasAnyPicks() {
        for (let r = 0; r < 6; r++) {
            if (this.bracket[r] && Object.keys(this.bracket[r]).length > 0) return true;
        }
        return false;
    },

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
        } else {
            indicator.style.display = 'none';
        }
        this.render();
    },

    async clearAll() {
        if (!confirm('Clear ALL data for this bracket? Cannot be undone!')) return;
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

    isRoundComplete(round) {
        const count = 32 / Math.pow(2, round);
        for (let m = 0; m < count; m++) {
            if (!this.bracket[round]?.[m]) return false;
        }
        return true;
    },

    isBracketComplete() {
        for (let r = 0; r < 6; r++) {
            if (!this.isRoundComplete(r)) return false;
        }
        return true;
    },

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

    pickWinner(round, matchIndex, playerId) {
        clearTimeout(this._advanceTimeout);
        const oldPick = this.bracket[round]?.[matchIndex];
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
        }

        this._advanceTimeout = setTimeout(() => this.nextMatch(), round === 5 ? 1500 : 400);
    },

    fireConfetti() {
        const container = document.getElementById('gameContainer');
        const confettiEl = document.createElement('div');
        confettiEl.className = 'confetti-container';
        const colors = ['#f1c40f', '#e74c3c', '#667eea', '#48bb78', '#ec4899', '#fff'];
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

    nextMatch() {
        clearTimeout(this._advanceTimeout);
        const matchCount = 32 / Math.pow(2, this.gameRound);

        if (this.gameMatch < matchCount - 1) {
            this.gameMatch++;
        } else if (this.isRoundComplete(this.gameRound)) {
            if (this.gameRound < 5) {
                this.gameState = 'round-summary';
            } else {
                this.gameState = 'bracket-summary';
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

    showBracketSummary() {
        this.gameState = 'bracket-summary';
        this.render();
    },

    startEditing() {
        this.gameState = 'picking';
        this.gameRound = 0;
        this.gameMatch = 0;
        this.render();
    },

    resumePicking() {
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

    selectWinner(round, matchup, playerId) {
        if (!this.bracket[round]) this.bracket[round] = {};
        this.bracket[round][matchup] = playerId;
        this.renderAdminBracket();
    },

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

        // Set round intensity on body for progressive atmosphere
        if (this.gameState === 'picking') {
            document.body.dataset.intensity = this.gameRound;
        } else {
            delete document.body.dataset.intensity;
        }

        switch (this.gameState) {
            case 'picking':      this.renderCardView(); break;
            case 'round-summary': this.renderRoundSummaryView(); break;
            default:              this.renderBracketSummaryView(); break;
        }
    },

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
            odds = {
                p1Pct: total > 0 ? Math.round((p1Count / total) * 100) : 0,
                p2Pct: total > 0 ? Math.round((p2Count / total) * 100) : 0,
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
            isFinals: this.gameRound === 5
        });
    },

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
            'Japan', 'United States', 'Canada', 'United Kingdom', 'Australia',
            'France', 'Germany', 'South Korea', 'Brazil', 'Netherlands',
            'Sweden', 'Italy', 'Belgium', 'Hungary', 'Switzerland',
            'New Zealand', 'Mexico', 'Spain', 'Poland', 'Czech Republic',
            'Austria', 'Norway', 'Denmark', 'Finland', 'Argentina',
            'China', 'Taiwan', 'Hong Kong', 'Singapore', 'Malaysia',
            'Thailand', 'Indonesia', 'Philippines', 'India', 'Russia',
            'Portugal', 'Ireland', 'Scotland', 'Romania', 'Serbia',
            'Croatia', 'South Africa', 'Colombia', 'Chile', 'Peru',
            'Israel', 'Luxembourg', 'Iceland', 'Other'
        ];
        countries.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c;
            opt.textContent = c;
            if (c === saved) opt.selected = true;
            sel.appendChild(opt);
        });
    },

    renderAdminBracket() {
        document.getElementById('bracket').innerHTML = this.buildBracketHTML(true);
        this.scheduleBracketRedraw('bracket');
    },

    buildBracketHTML(isAdmin) {
        const renderPlayer = (round, mi, player, clickable) => {
            if (!player) return `<div class="bp bp-tbd"><span class="bp-name">TBD</span></div>`;
            const sel = this.bracket[round]?.[mi] === player.id;
            const cls = this.getPlayerClasses(round, mi, player.id, sel);
            const click = clickable ? `onclick="app.selectWinner(${round}, ${mi}, ${player.id})"` : '';
            return `<div class="bp ${cls}" ${click}>
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

    scheduleBracketRedraw(containerId) {
        requestAnimationFrame(() => this.drawBracketSVG(containerId));
        // Also attach resize watcher
        this._attachBracketResizeWatcher(containerId);
    },

    _bracketResizeCleanup: null,

    _attachBracketResizeWatcher(containerId) {
        // Clean up previous watchers
        if (this._bracketResizeCleanup) {
            this._bracketResizeCleanup();
            this._bracketResizeCleanup = null;
        }

        let rafId = null;
        const redraw = () => {
            if (rafId) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(() => this.drawBracketSVG(containerId));
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

    async updateLeaderboard(gender) {
        const g = gender || this._lbGender || this.currentGender;
        this._lbGender = g;
        try {
            const resultsDoc = await db.collection('actualResults-' + g).doc('current').get();
            if (!resultsDoc.exists) {
                document.getElementById('leaderboardContent').innerHTML =
                    '<p style="text-align:center;color:#666;padding:40px;">No results entered yet.</p>';
                return;
            }
            const actualResults = resultsDoc.data().predictions || {};
            if (g === this.currentGender) this.actualResults = actualResults;
            const snap = await db.collection('brackets-' + g).get();
            if (snap.empty) {
                document.getElementById('leaderboardContent').innerHTML =
                    '<p style="text-align:center;color:#666;padding:40px;">No brackets submitted yet.</p>';
                return;
            }
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
                if (prevScore !== null && entry.score !== prevScore) rank = i + 1;
                prevScore = entry.score;
                entry.rank = rank;
            });
            this._lbScores = scores;
            this._lbPage = 0;
            this._renderLeaderboard();
        } catch (e) {
            console.error('Error updating leaderboard:', e, e.stack);
            document.getElementById('leaderboardContent').innerHTML = '<p style="text-align:center;color:#f00;">Error loading leaderboard</p>';
        }
    },

    _renderLeaderboard() {
        const scores = this._lbScores;
        const uid = this.currentUser?.uid;
        const container = document.getElementById('leaderboardContent');
        if (!scores.length) { container.innerHTML = '<p style="text-align:center;color:#666;padding:40px;">No data</p>'; return; }
        const top3 = scores.slice(0, 3);
        const podiumOrder = [top3[1], top3[0], top3[2]];
        const podiumHtml = podiumOrder.map((entry, i) => {
            if (!entry) return '<div class="lb-podium-item lb-podium-empty"></div>';
            const pos = i === 1 ? 1 : i === 0 ? 2 : 3;
            const isCenter = pos === 1;
            return `<div class="lb-podium-item lb-podium-${pos}${isCenter ? ' lb-podium-center' : ''}" onclick="app.viewBracketFromLeaderboard('${UI.escapeHtml(entry.uid)}')" style="cursor:pointer;">
                <div class="lb-podium-rank">${String(pos).padStart(2, '0')}</div>
                ${isCenter ? '<div class="lb-podium-trophy">\ud83c\udfc6</div>' : ''}
                <div class="lb-podium-name">${UI.escapeHtml(entry.name)}</div>
                <div class="lb-podium-loc">${UI.escapeHtml(entry.location || '')}</div>
                <div class="lb-podium-pts"><strong>${entry.score}</strong> <small>PTS</small></div>
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
                <span class="lb-row-rank">${String(entry.rank).padStart(2, '0')}</span>
                <span class="lb-row-name">${UI.escapeHtml(entry.name)}${entry.location ? ' <span class="lb-row-loc">' + UI.escapeHtml(entry.location) + '</span>' : ''}</span>
                <span class="lb-row-correct">${entry.correct} / ${entry.total}</span>
                <span class="lb-row-date">${_fmtDate(entry.timestamp)}</span>
                <span class="lb-row-pts">${entry.score}</span>
            </div>`;
        }).join('');
        // Pinned "You" row
        const youEntry = uid ? scores.find(e => e.uid === uid) : null;
        const youRowHtml = youEntry ? `<div class="lb-row lb-row-you">
                <span class="lb-row-rank">#${youEntry.rank}</span>
                <span class="lb-row-name">You (${UI.escapeHtml(youEntry.name)})${youEntry.location ? ' <span class="lb-row-loc">' + UI.escapeHtml(youEntry.location) + '</span>' : ''}</span>
                <span class="lb-row-correct">${youEntry.correct} / ${youEntry.total}</span>
                <span class="lb-row-date">${_fmtDate(youEntry.timestamp)}</span>
                <span class="lb-row-pts">${youEntry.score}</span>
            </div>` : '';
        const loadMoreHtml = hasMore
            ? '<div style="text-align:center;margin-top:16px"><button class="bracket-action-btn" onclick="app._lbLoadMore()">LOAD MORE RANKINGS</button></div>'
            : '';
        container.innerHTML = `
            <div class="lb-podium">${podiumHtml}</div>
            ${youRowHtml}
            <div class="lb-table">
                <div class="lb-table-header"><span>RANK</span><span>CONTENDER</span><span>CORRECT PICKS</span><span>SUBMITTED</span><span>TOTAL POINTS</span></div>
                <div id="lbRows">${rowsHtml}</div>
            </div>
            ${loadMoreHtml}`;
    },

    _lbLoadMore() {
        this._lbPage++;
        const start = this._lbPage * this._lbPageSize;
        const pageEntries = this._lbScores.slice(start, start + this._lbPageSize);
        const uid = this.currentUser?.uid;
        const hasMore = start + this._lbPageSize < this._lbScores.length;
        const newRows = pageEntries.map(entry => {
            const isYou = entry.uid === uid;
            const _fmtD = (ts) => { if (!ts) return '\u2014'; const d = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); };
            return `<div class="lb-row${isYou ? ' lb-row-you' : ''}">
                <span class="lb-row-rank">${String(entry.rank).padStart(2, '0')}</span>
                <span class="lb-row-name">${UI.escapeHtml(entry.name)}${entry.location ? ' <span class="lb-row-loc">' + UI.escapeHtml(entry.location) + '</span>' : ''}</span>
                <span class="lb-row-correct">${entry.correct} / ${entry.total}</span>
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

    showLeaderboard() {
        this._closeNav();
        this._lbGender = this.currentGender;
        document.getElementById('lbMenTab')?.classList.toggle('active', this.currentGender === 'men');
        document.getElementById('lbWomenTab')?.classList.toggle('active', this.currentGender === 'women');
        this.updateLeaderboard();
        document.getElementById('leaderboardModal').style.display = 'block';
        this._startLeaderboardListener();
    },

    closeLeaderboard() {
        document.getElementById('leaderboardModal').style.display = 'none';
        this._stopLeaderboardListener();
    },

    _lbUnsubscribe: null,

    _startLeaderboardListener() {
        this._stopLeaderboardListener();
        const g = this._lbGender || this.currentGender;
        this._lbUnsubscribe = db.collection('brackets-' + g).onSnapshot(() => {
            if (document.getElementById('leaderboardModal')?.style.display === 'block') {
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

    viewBracketFromLeaderboard(uid) {
        const lbGender = this._lbGender || this.currentGender;
        this.closeLeaderboard();
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
        this._closeNav();
        const bracketsList = document.getElementById('bracketsList');
        const searchInput = document.getElementById('bracketSearch');
        if (searchInput) searchInput.value = '';
        try {
            const snap = await db.collection('brackets-' + this.currentGender).get();
            if (snap.empty) {
                bracketsList.innerHTML = '<p style="text-align:center;color:rgba(255,255,255,0.4);padding:40px;">No brackets saved yet!</p>';
            } else {
                this._allBracketItems = [];
                snap.forEach(doc => {
                    const data = doc.data();
                    const uid = doc.id;
                    const name = data.displayName || 'Anonymous';
                    const location = data.location || '';
                    const date = data.timestamp ? data.timestamp.toDate() : null;
                    const dateStr = date ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
                    this._allBracketItems.push({ uid, name, location, date, dateStr });
                });
                this._allBracketItems.sort((a, b) => (b.date || 0) - (a.date || 0));
                this._renderBracketList(this._allBracketItems);
            }
        } catch (e) {
            bracketsList.innerHTML = '<p style="text-align:center;color:#f00;">Error loading brackets</p>';
            console.error('Error loading brackets:', e);
        }
        document.getElementById('bracketsModal').style.display = 'block';
    },

    _renderBracketList(items) {
        const bracketsList = document.getElementById('bracketsList');
        if (!items.length) {
            bracketsList.innerHTML = '<p style="text-align:center;color:rgba(255,255,255,0.4);padding:20px;">No matches found</p>';
            return;
        }
        const isMe = (uid) => uid === this.currentUser?.uid;
        bracketsList.innerHTML = items.map(item => `
            <div class="ab-row${isMe(item.uid) ? ' ab-row-you' : ''}" onclick="app.loadSpecificBracket('${UI.escapeHtml(item.uid)}')">
                <div class="ab-info">
                    <div class="ab-name-wrap">
                        ${isMe(item.uid) ? '<span class="ab-you-label">YOUR BRACKET</span>' : ''}
                        <span class="ab-name">${UI.escapeHtml(item.name)}</span>
                    </div>
                    ${item.location ? '<span class="ab-loc">' + UI.escapeHtml(item.location) + '</span>' : ''}
                </div>
                <div class="ab-meta">
                    <div class="ab-date-wrap">
                        <span class="ab-date-label">SUBMITTED</span>
                        <span class="ab-date">${UI.escapeHtml(item.dateStr)}</span>
                    </div>
                    <span class="ab-view">VIEW DETAILS →</span>
                </div>
            </div>`).join('');
    },

    filterBrackets(query) {
        if (!this._allBracketItems) return;
        const q = query.toLowerCase().trim();
        const filtered = q
            ? this._allBracketItems.filter(item => item.name.toLowerCase().includes(q) || item.location.toLowerCase().includes(q))
            : this._allBracketItems;
        this._renderBracketList(filtered);
    },

    async loadSpecificBracket(uid) {
        try {
            const doc = await db.collection('brackets-' + this.currentGender).doc(uid).get();
            if (doc.exists) {
                const data = doc.data();
                this.bracket = data.predictions || {};
                this._viewingBracketName = data.displayName || 'Anonymous';
                this.viewingOtherBracket = (uid !== this.currentUser?.uid);
                this.gameState = 'bracket-summary';
                UI.showBackToMine(this.viewingOtherBracket);
                await this.loadActualResults();
                this.render();
                this.closeModal();
            } else {
                showToast('Bracket not found.', 'error');
            }
        } catch (e) {
            console.error('Error loading bracket:', e);
            showToast('Error loading bracket', 'error');
        }
    },

    viewMyBracket() {
        this._closeNav();
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

    // ── Stats Dashboard ────────────────────────────────────────

    _statsCharts: [],

    async showStats() {
        this._closeNav();
        const content = document.getElementById('statsContent');
        content.innerHTML = '<p style="text-align:center;padding:40px;color:rgba(255,255,255,0.5);">Loading stats...</p>';
        document.getElementById('statsModal').style.display = 'block';

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

            // Overview cards
            const total = menSnap.size + womenSnap.size;
            html += `<div class="stat-cards">
                <div class="stat-card">
                    <div class="stat-number">${total}</div>
                    <div class="stat-label">Total Brackets</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number">${menSnap.size}</div>
                    <div class="stat-label">Men's Brackets</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number">${womenSnap.size}</div>
                    <div class="stat-label">Women's Brackets</div>
                </div>
            </div>`;

            // Podiums side by side
            html += `<div class="stats-grid">`;
            html += this._buildPodium("Men's Champion Picks", menData.champions);
            html += this._buildPodium("Women's Champion Picks", womenData.champions);
            html += `</div>`;

            // Bar charts
            html += `<div class="stats-grid">`;
            html += `<div class="stat-section"><h3 class="stat-section-title">Men's Champion Distribution</h3><div style="position:relative;height:250px;"><canvas id="menBarChart"></canvas></div></div>`;
            html += `<div class="stat-section"><h3 class="stat-section-title">Women's Champion Distribution</h3><div style="position:relative;height:250px;"><canvas id="womenBarChart"></canvas></div></div>`;
            html += `</div>`;

            // Most controversial
            html += `<div class="stats-grid">`;
            html += this._buildControversial("Men's Most Controversial", menData.controversial, this.menPlayers);
            html += this._buildControversial("Women's Most Controversial", womenData.controversial, this.womenPlayers);
            html += `</div>`;

            // Pick popularity
            html += `<div class="stats-grid">`;
            html += this._buildPickPopularity("Men's Pick Popularity", menData.pickData, this.menPlayers);
            html += this._buildPickPopularity("Women's Pick Popularity", womenData.pickData, this.womenPlayers);
            html += `</div>`;

            // Survival tracker
            html += `<div class="stats-grid">`;
            html += this._buildSurvivalTracker("Men's Survival", menSnap, 'men', menActualResults);
            html += this._buildSurvivalTracker("Women's Survival", womenSnap, 'women', womenActualResults);
            html += `</div>`;

            // Achievement badges
            html += this._buildAchievements(menSnap, womenSnap, menActualResults, womenActualResults);

            content.innerHTML = html;

            // Render bar charts
            this._renderBarChart('menBarChart', menData.champions, 'men');
            this._renderBarChart('womenBarChart', womenData.champions, 'women');
        } catch (e) {
            console.error('Error loading stats:', e);
            content.innerHTML = '<p style="text-align:center;color:#f00;">Error loading stats</p>';
        }
    },

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

    _buildPodium(title, champions) {
        if (champions.length === 0) {
            return `<div class="stat-section"><h3 class="stat-section-title">${UI.escapeHtml(title)}</h3>
                <p style="text-align:center;color:rgba(255,255,255,0.4);padding:20px;">No picks yet</p></div>`;
        }

        const total = champions.reduce((s, [, c]) => s + c, 0);
        const medals = ['🥇', '🥈', '🥉'];
        const podiumHtml = champions.slice(0, 3).map(([name, count], i) => {
            const pct = ((count / total) * 100).toFixed(1);
            return `<div class="podium-item podium-${i + 1}">
                <div class="podium-medal">${medals[i]}</div>
                <div class="podium-name">${UI.escapeHtml(name)}</div>
                <div class="podium-stats">${count} picks (${pct}%)</div>
            </div>`;
        }).join('');

        return `<div class="stat-section">
            <h3 class="stat-section-title">${UI.escapeHtml(title)}</h3>
            <div class="podium">${podiumHtml}</div>
        </div>`;
    },

    _buildControversial(title, data, players) {
        if (!data) {
            return `<div class="stat-section"><h3 class="stat-section-title">${UI.escapeHtml(title)}</h3>
                <p style="text-align:center;color:rgba(255,255,255,0.4);padding:20px;">Not enough data</p></div>`;
        }

        const p1 = players.find(p => p.id === data.player1.id);
        const p2 = players.find(p => p.id === data.player2.id);
        const p1Pct = Math.round((data.player1.count / data.total) * 100);
        const p2Pct = 100 - p1Pct;

        return `<div class="stat-section">
            <h3 class="stat-section-title">${UI.escapeHtml(title)}</h3>
            <div class="controversial-card">
                <div class="controversial-round">${ROUND_NAMES[data.round]}</div>
                <div class="controversial-matchup">
                    <div class="controversial-player">
                        <span class="controversial-name">${UI.escapeHtml(p1?.name || '?')}</span>
                        <span class="controversial-pct">${p1Pct}%</span>
                    </div>
                    <div class="controversial-bar">
                        <div class="controversial-fill-left" style="width:${p1Pct}%"></div>
                        <div class="controversial-fill-right" style="width:${p2Pct}%"></div>
                    </div>
                    <div class="controversial-player" style="text-align:right;">
                        <span class="controversial-name">${UI.escapeHtml(p2?.name || '?')}</span>
                        <span class="controversial-pct">${p2Pct}%</span>
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
    },

    // ── Bracket Similarity ──────────────────────────────────────

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

        // Kendo Scholar: highest accuracy in rounds 3-5 (R16, QF, SF, Finals)
        let scholarName = '', scholarPct = 0;
        [{ gender: 'men', results: menActualResults }, { gender: 'women', results: womenActualResults }].forEach(({ gender, results: actualResults }) => {
            if (!actualResults) return;
            const genderDocs = allDocs.filter(d => d.gender === gender && d.predictions);
            genderDocs.forEach(d => {
                let correct = 0, total = 0;
                for (let r = 2; r < 6; r++) {
                    const actual = actualResults[r] || {};
                    const picks = d.predictions[r] || {};
                    Object.keys(actual).forEach(m => {
                        total++;
                        if (picks[m] === actual[m]) correct++;
                    });
                }
                const pct = total > 0 ? correct / total : 0;
                if (pct > scholarPct) {
                    scholarPct = pct;
                    scholarName = d.displayName || 'Anonymous';
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

        // Kendo Scholar
        if (scholarName && scholarPct > 0) {
            html += `<div class="badge-card">
                <div class="badge-icon">🎓</div>
                <div class="badge-title">KENDO SCHOLAR</div>
                <div class="badge-desc">Best late-round accuracy (${Math.round(scholarPct * 100)}%)</div>
                <div class="badge-names">${UI.escapeHtml(scholarName)}</div>
            </div>`;
        }

        html += `</div></div>`;
        return html;
    },

    // ── Scoring Rules ───────────────────────────────────────────

    showScoringRules() {
        this._closeNav();
        document.getElementById('scoringRulesModal').style.display = 'block';
    },

    closeScoringRules() {
        document.getElementById('scoringRulesModal').style.display = 'none';
    },

    showDonateModal() {
        document.getElementById('donateModal').style.display = 'block';
    },

    closeDonateModal() {
        document.getElementById('donateModal').style.display = 'none';
    },

    // ── Odds toggle ───────────────────────────────────────────

    async toggleOdds() {
        this.showOdds = !this.showOdds;
        if (this.showOdds && !this._oddsCache) {
            await this._loadOdds();
        }
        this.render();
    },

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
    if (app.hasAnyPicks() && !app.userBracketData) {
        e.preventDefault();
        e.returnValue = '';
    }
});

window.addEventListener('click', event => {
    if (event.target === document.getElementById('bracketsModal')) {
        app.closeModal();
    }
    if (event.target === document.getElementById('statsModal')) {
        app.closeStatsModal();
    }
    if (event.target === document.getElementById('leaderboardModal')) {
        app.closeLeaderboard();
    }
    if (event.target === document.getElementById('signInModal')) {
        app.closeSignInModal();
    }
    if (event.target === document.getElementById('scoringRulesModal')) {
        app.closeScoringRules();
    }
    if (event.target === document.getElementById('donateModal')) {
        app.closeDonateModal();
    }
    // Close menu when clicking outside
    const menu = document.getElementById('menuDropdown');
    const toggle = document.querySelector('.menu-toggle');
    if (menu && !menu.contains(event.target) && event.target !== toggle) {
        menu.classList.remove('open');
    }
});


