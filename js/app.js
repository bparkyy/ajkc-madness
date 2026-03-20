// Main application logic

const ROUND_NAMES = ['Round of 64', 'Round of 32', 'Round of 16', 'Quarterfinals', 'Semifinals', 'Finals'];
const ROUND_NAMES_SHORT = ['R64', 'R32', 'R16', 'QF', 'SF', 'F'];
const ROUND_NAMES_JP = ['1回戦', '2回戦', '3回戦', '準々決勝', '準決勝', '決勝'];
const ROUND_INTENSITY = [0, 0.15, 0.3, 0.5, 0.75, 1.0]; // 0 = calm, 1 = max drama

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
        this.initBracket();
    },

    goHome() {
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
                alert('Google sign-in failed. Please try again.');
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
        await this.loadUserBracket();
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
        UI.showBackToMine(false);

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
            alert(this.isLocked
                ? 'Both brackets locked! Users can no longer submit.'
                : 'Both brackets unlocked! Users can now submit again.');
        } catch (e) { alert('Error toggling lock: ' + e.message); }
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
            alert('Something went wrong — please refresh.');
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
            alert('Please enter your name!');
            if (nameInput) nameInput.focus();
            return;
        }
        if (this.isLocked && !this.adminMode) {
            alert('Tournament is locked! Bracket submissions are no longer allowed.');
            return;
        }
        if (this.viewingOtherBracket) {
            alert("You're viewing someone else's bracket. Click 'Back to My Bracket' first.");
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
            alert(`Bracket saved for ${displayName}!`);
            this.updateBracketCount();
        }).catch(e => alert('Error saving bracket: ' + e.message));
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
                    alert('Sign-in failed — no email found.');
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
                    alert('You are not authorised as an admin. Make sure your email is in the admins collection.');
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
            alert('All data cleared!');
        } catch (e) { alert('Error: ' + e.message); }
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

        this.render();

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
            alert(`${this.currentGender === 'men' ? "Men's" : "Women's"} results saved!`);
        } catch (e) {
            alert('Error saving results: ' + e.message);
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
            alert(`Final result for ${this.currentGender === 'men' ? "Men's" : "Women's"} set to: ${score || '?'}, ${technique || '?'}`);
        } catch (e) {
            alert('Error saving: ' + e.message);
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
                score += techniqueBonus;
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
            console.error('Error updating leaderboard:', e);
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
            return `<div class="lb-podium-item lb-podium-${pos}${isCenter ? ' lb-podium-center' : ''}">
                <div class="lb-podium-rank">${String(pos).padStart(2, '0')}</div>
                ${isCenter ? '<div class="lb-podium-trophy">\ud83c\udfc6</div>' : ''}
                <div class="lb-podium-name">${UI.escapeHtml(entry.name)}</div>
                <div class="lb-podium-loc">${UI.escapeHtml(entry.location || '')}</div>
                <div class="lb-podium-pts"><strong>${entry.score}</strong> <small>PTS</small></div>
            </div>`;
        }).join('');
        const start = this._lbPage * this._lbPageSize;
        const pageEntries = scores.slice(start, start + this._lbPageSize);
        const hasMore = start + this._lbPageSize < scores.length;
        const rowsHtml = pageEntries.map(entry => {
            const isYou = entry.uid === uid;
            return `<div class="lb-row${isYou ? ' lb-row-you' : ''}">
                <span class="lb-row-rank">${String(entry.rank).padStart(2, '0')}</span>
                <span class="lb-row-name">${UI.escapeHtml(entry.name)}${entry.location ? ' <span class="lb-row-loc">' + UI.escapeHtml(entry.location) + '</span>' : ''}</span>
                <span class="lb-row-correct">${entry.correct} / ${entry.total}</span>
                <span class="lb-row-pts">${entry.score}</span>
            </div>`;
        }).join('');
        const loadMoreHtml = hasMore
            ? '<div style="text-align:center;margin-top:16px"><button class="bracket-action-btn" onclick="app._lbLoadMore()">LOAD MORE RANKINGS</button></div>'
            : '';
        container.innerHTML = `
            <div class="lb-podium">${podiumHtml}</div>
            <div class="lb-table">
                <div class="lb-table-header"><span>RANK</span><span>CONTENDER</span><span>CORRECT PICKS</span><span>TOTAL POINTS</span></div>
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
            return `<div class="lb-row${isYou ? ' lb-row-you' : ''}">
                <span class="lb-row-rank">${String(entry.rank).padStart(2, '0')}</span>
                <span class="lb-row-name">${UI.escapeHtml(entry.name)}${entry.location ? ' <span class="lb-row-loc">' + UI.escapeHtml(entry.location) + '</span>' : ''}</span>
                <span class="lb-row-correct">${entry.correct} / ${entry.total}</span>
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
        this._lbGender = this.currentGender;
        document.getElementById('lbMenTab')?.classList.toggle('active', this.currentGender === 'men');
        document.getElementById('lbWomenTab')?.classList.toggle('active', this.currentGender === 'women');
        this.updateLeaderboard();
        document.getElementById('leaderboardModal').style.display = 'block';
    },

    closeLeaderboard() {
        document.getElementById('leaderboardModal').style.display = 'none';
    },

    // ── View all brackets ───────────────────────────────────────

    async viewAllBrackets() {
        const bracketsList = document.getElementById('bracketsList');
        try {
            const snap = await db.collection('brackets-' + this.currentGender).get();
            if (snap.empty) {
                bracketsList.innerHTML = '<p style="text-align:center;color:#666;">No brackets saved yet!</p>';
            } else {
                let html = '';
                snap.forEach(doc => {
                    const data = doc.data();
                    const uid = doc.id;
                    const name = UI.escapeHtml(data.displayName || 'Anonymous');
                    const date = data.timestamp ? data.timestamp.toDate().toLocaleString() : 'Unknown date';
                    html += `<div class="bracket-item" data-uid="${UI.escapeHtml(uid)}">
                        <div class="bracket-info">
                            <div class="bracket-name">${name}</div>
                            <div class="bracket-date">Saved: ${UI.escapeHtml(date)}</div>
                        </div>
                        <button class="view-bracket-btn">View →</button>
                    </div>`;
                });
                bracketsList.innerHTML = html;
                document.querySelectorAll('.bracket-item').forEach(item => {
                    item.addEventListener('click', () => {
                        app.loadSpecificBracket(item.getAttribute('data-uid'));
                    });
                });
            }
        } catch (e) {
            bracketsList.innerHTML = '<p style="text-align:center;color:#f00;">Error loading brackets</p>';
            console.error('Error loading brackets:', e);
        }
        document.getElementById('bracketsModal').style.display = 'block';
    },

    async loadSpecificBracket(uid) {
        try {
            const doc = await db.collection('brackets-' + this.currentGender).doc(uid).get();
            if (doc.exists) {
                const data = doc.data();
                this.bracket = data.predictions;
                this._viewingBracketName = data.displayName || 'Anonymous';
                this.viewingOtherBracket = (uid !== this.currentUser?.uid);
                this.gameState = 'bracket-summary';
                UI.showBackToMine(this.viewingOtherBracket);
                this.render();
                this.closeModal();
            }
        } catch (e) {
            console.error('Error loading bracket:', e);
            alert('Error loading bracket');
        }
    },

    viewMyBracket() {
        this.viewingOtherBracket = false;
        UI.showBackToMine(false);
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
                const pickHtml = sorted.map(([pid, count]) => {
                    const player = players.find(p => p.id === Number(pid));
                    const name = player ? player.name : 'Unknown';
                    const pct = Math.round((count / total) * 100);
                    return `<div class="popularity-bar-row">
                        <span class="popularity-name">${UI.escapeHtml(name)}</span>
                        <div class="popularity-bar-bg"><div class="popularity-bar-fill" style="width:${pct}%"></div></div>
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
app.init();

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
    // Close menu when clicking outside
    const menu = document.getElementById('menuDropdown');
    const toggle = document.querySelector('.menu-toggle');
    if (menu && !menu.contains(event.target) && event.target !== toggle) {
        menu.classList.remove('open');
    }
});


