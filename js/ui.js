// UI rendering helpers

const UI = {
    escapeHtml(str) {
        if (typeof str !== 'string') return String(str);
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
        return str.replace(/[&<>"']/g, c => map[c]);
    },

    updateAuthUI(isAdmin) {
        const btn = document.getElementById('adminBtn');
        if (btn) btn.style.display = isAdmin ? 'inline-flex' : 'none';
    },

    showBackToMine(visible) {
        const btn = document.getElementById('backToMineBtn');
        if (btn) btn.style.display = visible ? 'inline-block' : 'none';
    },

    formatRank(rank) {
        const s = String(rank);
        if (s.startsWith('R')) return `${s.slice(1)} Dan Renshi`;
        return `${s} Dan`;
    },

    // ── Card matchup view ────────────────────────────────────────

    renderCardMatchup({ player1, player2, roundName, roundNameJp, matchIndex, totalMatches, roundIndex, currentPick, isFirstMatch, odds, showOdds, isFinals, pickHistory }) {
        const progress = ((matchIndex + (currentPick ? 1 : 0)) / totalMatches) * 100;
        const finalsClass = isFinals ? ' finals-matchup' : '';

        // Overall bracket progress
        const totalPicks = [32, 16, 8, 4, 2, 1];
        const totalAllPicks = totalPicks.reduce((a, b) => a + b, 0); // 63
        let completedPicks = 0;
        for (let r = 0; r < 6; r++) {
            const rPicks = app.bracket[r] || {};
            completedPicks += Object.keys(rPicks).length;
        }
        const overallPct = Math.round((completedPicks / totalAllPicks) * 100);

        const card = (player, picked, pct) => {
            if (!player) return '<div class="player-card disabled"><span class="card-name">TBD</span></div>';
            const oddsHtml = (showOdds && pct !== null) ? `<span class="card-odds">${pct}% picked</span>` : '';
            const finalsCardClass = isFinals ? ' finals-card' : '';
            const rankStr = String(player.rank);
            const rankLabel = rankStr.startsWith('R') ? `${rankStr.slice(1)} Dan Renshi` : `${rankStr} Dan`;
            const imgHtml = player.img
                ? `<div class="card-avatar"><img src="${this.escapeHtml(player.img)}" alt="" loading="lazy"></div>`
                : `<div class="card-avatar card-avatar-fallback">${this.escapeHtml(player.name.charAt(0))}</div>`;
            return `<div class="player-card${picked ? ' picked' : ''}${finalsCardClass}" onclick="app.pickWinner(${roundIndex}, ${matchIndex}, ${player.id})">
                ${imgHtml}
                <span class="card-prefecture">${this.escapeHtml(player.prefecture)}</span>
                <span class="card-name">${this.escapeHtml(player.name)}</span>
                ${player.nameJp ? `<span class="card-name-jp">${this.escapeHtml(player.nameJp)}</span>` : ''}
                <span class="card-rank">${rankLabel}</span>
                ${oddsHtml}
            </div>`;
        };

        const oddsToggle = showOdds && odds && odds.total > 0
            ? `<div class="crowd-pcts-inline">${odds.p1Pct}% vs ${odds.p2Pct}%</div>`
            : '';

        const oddsCheckbox = `<div class="odds-toggle">
            <label><input type="checkbox" ${showOdds ? 'checked' : ''} onchange="app.toggleOdds()"> Show crowd predictions</label>
        </div>`;

        const roundTabs = ['R64', 'R32', 'R16', 'QF', 'SF', 'F'].map((label, i) => {
            const active = i === roundIndex ? ' active' : '';
            const disabled = i > 0 && !app.isRoundComplete(i - 1) ? ' disabled' : '';
            return `<button class="round-tab${active}" ${disabled ? 'disabled' : `onclick="app.jumpToRound(${i})"`}>${label}</button>`;
        }).join('');

        const finalsHeader = '';

        return `
            <div class="game-screen${finalsClass}">
                <div class="round-tabs">${roundTabs}</div>
                ${finalsHeader}
                <div class="game-header">
                    <div class="game-round-name">${isFinals ? '\u2694\ufe0f ' + this.escapeHtml(roundName) + ' \u2694\ufe0f' : this.escapeHtml(roundName)}</div>
                    <div class="game-match-info">Match ${matchIndex + 1} of ${totalMatches}</div>
                </div>
                <div class="bracket-progress">
                    <div class="bracket-progress-bar"><div class="bracket-progress-fill" style="width:${overallPct}%"></div></div>
                    <div class="bracket-progress-text">
                        <span>${completedPicks} of ${totalAllPicks} picks</span>
                        <span>${overallPct}% complete</span>
                    </div>
                </div>
                ${oddsCheckbox}
                <div class="card-matchup">
                    ${card(player1, currentPick === player1?.id, odds ? odds.p1Pct : null)}
                    <div class="vs-divider">${isFinals ? '\u2694\ufe0f' : 'VS'}</div>
                    ${card(player2, currentPick === player2?.id, odds ? odds.p2Pct : null)}
                </div>
                <div class="game-nav">
                    <button onclick="app.prevMatch()" ${isFirstMatch ? 'disabled' : ''}>\u2190 Back</button>
                    <button class="undo-btn" onclick="app.undoLastPick()" ${!pickHistory || pickHistory.length === 0 ? 'disabled' : ''}>↩ Undo</button>
                    <button onclick="app.nextMatch()" ${!currentPick ? 'disabled' : ''}>Next \u2192</button>
                </div>
            </div>`;
    },

    // ── Round summary view ───────────────────────────────────────

    renderRoundSummary({ roundName, roundNameJp, nextRoundName, nextRoundNameJp, picks, isFinalRound }) {
        const winnersHtml = picks.map((p, i) =>
            `<span class="winner-chip" style="animation-delay:${i * 0.04}s">${this.escapeHtml(p.winner)}</span>`
        ).join('');

        const btnText = isFinalRound
            ? '\ud83c\udfc6 View Your Bracket'
            : `Continue to ${this.escapeHtml(nextRoundName)} →`;
        const btnAction = isFinalRound ? 'app.showBracketSummary()' : 'app.advanceToNextRound()';

        return `
            <div class="round-complete-screen">
                <div class="round-complete-header">
                    <div class="round-complete-check">✅</div>
                    <h2 class="round-complete-title">${this.escapeHtml(roundName)}</h2>
                    <p class="round-complete-jp">${this.escapeHtml(roundNameJp || '')} 完了</p>
                </div>
                <!-- Ad slot: Between rounds -->
                <div class="ad-slot" id="adRoundTransition" style="display:none"></div>
                <div class="round-complete-ticker">
                    <p class="ticker-label">${picks.length} winners advance</p>
                    <div class="winner-chips">${winnersHtml}</div>
                </div>
                <button class="continue-btn" onclick="${btnAction}">${btnText}</button>
            </div>`;
    },

    // ── Bracket summary view ─────────────────────────────────────

    renderBracketSummary({ rounds, champion, isReadonly, isComplete, actualResults, viewingName }) {
        // Status label
        const genderLabel = app.currentGender === 'men' ? "MENS BRACKET" : "WOMENS BRACKET";
        const statusLabel = isReadonly && viewingName
            ? `<div class="bracket-status-label">${this.escapeHtml(viewingName)}'s ${genderLabel}</div>`
            : isComplete
                ? '<div class="bracket-status-label">BRACKET COMPLETED!</div>'
                : '<div class="bracket-status-label bracket-status-progress">BRACKET IN PROGRESS</div>';

        // Big title — personalize if signed in
        const userName = document.getElementById('userName')?.value?.trim() || '';
        const titleText = userName ? `${this.escapeHtml(userName).toUpperCase()}'S AJKC<br>BRACKET` : 'AJKC BRACKET<br>CHALLENGE';
        const titleHtml = `<h1 class="bracket-page-title">${titleText}</h1>`;

        // Gender tabs (hide when viewing someone else's)
        const genderTabs = isReadonly ? '' : `<div class="bracket-gender-tabs">
            <button id="menBtn" class="bracket-gender-tab${app.currentGender === 'men' ? ' active' : ''}" onclick="app.switchGender('men')">MENS BRACKET <span style="opacity:0.5;font-size:0.85em;">男子</span></button>
            <button id="womenBtn" class="bracket-gender-tab${app.currentGender === 'women' ? ' active' : ''}" onclick="app.switchGender('women')">WOMENS BRACKET <span style="opacity:0.5;font-size:0.85em;">女子</span></button>
        </div>`;

        // Stats card bar
        let correctPicks = 0, totalActual = 0, totalPoints = 0;
        const roundPoints = [1, 2, 4, 8, 16, 32];
        if (actualResults) {
            for (let r = 0; r < 6; r++) {
                const actual = actualResults[r] || {};
                const picks = app.bracket[r] || {};
                Object.keys(actual).forEach(m => {
                    totalActual++;
                    if (picks[m] === actual[m]) {
                        correctPicks++;
                        totalPoints += roundPoints[r];
                    }
                });
            }
        }
        // Technique bonus (loaded async, may not be available on first render)
        if (app._actualTechniqueCache && app.bracket) {
            const userTech = document.getElementById('userTechnique')?.value || '';
            if (userTech && userTech === app._actualTechniqueCache) totalPoints += 5;
        }
        // Correct picks bonus
        totalPoints += correctPicks;
        // Perfect bracket bonus
        if (correctPicks === totalActual && totalActual > 0) totalPoints += 50;
        const precisionPct = totalActual > 0 ? Math.round((correctPicks / totalActual) * 100) : 0;
        const dateStr = app._submissionDate
            ? app._submissionDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase() + ' ' + app._submissionDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
            : 'NOT YET';
        const championDisplay = champion || '\u2014';
        const hasResults = actualResults && totalActual > 0;
        const statsBar = `<div class="bracket-stats-container">
        <div class="bracket-stats-bar bracket-stats-row-1">
            <div class="bracket-stat-card">
                <span class="bracket-stat-label">CORRECT PICKS</span>
                <span class="bracket-stat-value">${hasResults ? correctPicks + ' / ' + totalActual : 'TBD'}</span>
            </div>
            <div class="bracket-stat-card">
                <span class="bracket-stat-label">PRECISION RATE</span>
                <span class="bracket-stat-value">${hasResults ? precisionPct + '%' : 'TBD'}</span>
            </div>
            <div class="bracket-stat-card">
                <span class="bracket-stat-label">POINTS SCORED</span>
                <span class="bracket-stat-value">${hasResults ? totalPoints : 'TBD'}</span>
            </div>
            <div class="bracket-stat-card">
                <span class="bracket-stat-label">PREDICTED WINNER</span>
                <span class="bracket-stat-value">${this.escapeHtml(championDisplay)}</span>
            </div>
            <div class="bracket-stat-card" style="cursor:help;" title="How often your picks match the most popular choice for each matchup">
                <span class="bracket-stat-label">CROWD SIMILARITY</span>
                <span class="bracket-stat-value" id="bracketSimilarity">—</span>
            </div>
            <div class="bracket-stat-card">
                <span class="bracket-stat-label">SUBMISSION DATE</span>
                <span class="bracket-stat-value bracket-stat-date">${dateStr}</span>
            </div>
        </div>
        </div>`;

        // Action buttons
        const actionBtns = !isReadonly
            ? `<div class="bracket-action-btns">
                <button class="bracket-action-btn bracket-action-gold" onclick="app.startEditing()">EDIT PICKS</button>
                <button class="bracket-action-btn" onclick="app.shareBracket()">📸 DOWNLOAD BRACKET</button>
                <button class="bracket-action-btn bracket-action-share" onclick="app.shareLink()">🔗 SHARE LINK</button>
            </div>`
            : `<div class="bracket-action-btns">
                <button class="bracket-action-btn" onclick="app.shareBracket()">📸 DOWNLOAD BRACKET</button>
            </div>`;

        const legendHtml = actualResults
            ? `<div class="bracket-legend">
                <span class="legend-item legend-correct"><span class="legend-dot"></span> Correct pick</span>
                <span class="legend-item legend-incorrect"><span class="legend-dot"></span> Incorrect pick</span>
            </div>`
            : '';

        const incompleteHtml = !isComplete && !isReadonly
            ? '<div class="bracket-incomplete-notice">⚠️ Your bracket is not complete yet.</div>'
            : '';

        const resumeHtml = !isComplete && !isReadonly
            ? '<div style="text-align:center;margin-bottom:20px"><button class="bracket-action-btn" onclick="app.resumePicking()">▶️ Resume Picking</button></div>'
            : '';

        const nameHtml = '';

        const bracketVisualHtml = `<div class="bracket-tree-wrapper">
                <div class="bracket-visual-area" id="bracketVisualArea"></div>
            </div>`;

        const reminderHtml = '';

        return `
            <div class="bracket-summary">
                ${statusLabel}
                <div class="bracket-page-header">
                    <div>
                        ${titleHtml}
                    </div>
                    ${actionBtns}
                </div>
                ${statsBar}
                <!-- Ad slot: Below stats bar -->
                <div class="ad-slot" id="adBracketStats" style="display:none"></div>
                ${genderTabs}
                ${nameHtml}
                ${reminderHtml}
                ${incompleteHtml}
                ${resumeHtml}
                <div style="text-align:center">${legendHtml}</div>
                ${bracketVisualHtml}
                <!-- Ad slot: Below bracket tree -->
                <div class="ad-slot" id="adBelowBracket" style="display:none"></div>
            </div>`;
    }
};
