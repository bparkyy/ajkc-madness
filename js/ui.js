// UI rendering helpers

const UI = {
    escapeHtml(str) {
        if (typeof str !== 'string') return String(str);
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
        return str.replace(/[&<>"']/g, c => map[c]);
    },

    updateAuthUI() { /* admin button always visible */ },

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

    renderCardMatchup({ player1, player2, roundName, roundNameJp, matchIndex, totalMatches, roundIndex, currentPick, isFirstMatch, odds, showOdds, isFinals }) {
        const progress = ((matchIndex + (currentPick ? 1 : 0)) / totalMatches) * 100;
        const finalsClass = isFinals ? ' finals-matchup' : '';

        const card = (player, picked, pct) => {
            if (!player) return '<div class="player-card disabled"><span class="card-name">TBD</span></div>';
            const oddsHtml = (showOdds && pct !== null) ? `<span class="card-odds">${pct}% picked</span>` : '';
            const finalsCardClass = isFinals ? ' finals-card' : '';
            const rankStr = String(player.rank);
            const rankLabel = rankStr.startsWith('R') ? `${rankStr.slice(1)} Dan Renshi` : `${rankStr} Dan`;
            return `<div class="player-card${picked ? ' picked' : ''}${finalsCardClass}" onclick="app.pickWinner(${roundIndex}, ${matchIndex}, ${player.id})">
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
                    <div class="game-progress"><div class="game-progress-fill" style="width:${progress}%"></div></div>
                </div>
                ${oddsCheckbox}
                <div class="card-matchup">
                    ${card(player1, currentPick === player1?.id, odds ? odds.p1Pct : null)}
                    <div class="vs-divider">${isFinals ? '\u2694\ufe0f' : 'VS'}</div>
                    ${card(player2, currentPick === player2?.id, odds ? odds.p2Pct : null)}
                </div>
                <div class="game-nav">
                    <button onclick="app.prevMatch()" ${isFirstMatch ? 'disabled' : ''}>\u2190 Back</button>
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
                <div class="ad-slot" id="adRoundTransition"></div>
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
        const genderLabel = app.currentGender === 'men' ? "MEN'S BRACKET" : "WOMEN'S BRACKET";
        const statusLabel = isReadonly && viewingName
            ? `<div class="bracket-status-label">${this.escapeHtml(viewingName)}'s ${genderLabel}</div>`
            : isComplete
                ? '<div class="bracket-status-label">BRACKET COMPLETED!</div>'
                : '<div class="bracket-status-label bracket-status-progress">BRACKET IN PROGRESS</div>';

        // Big title
        const titleHtml = `<h1 class="bracket-page-title">AJKC BRACKET<br>CHALLENGE</h1>`;

        // Gender tabs (hide when viewing someone else's)
        const genderTabs = isReadonly ? '' : `<div class="bracket-gender-tabs">
            <button id="menBtn" class="bracket-gender-tab${app.currentGender === 'men' ? ' active' : ''}" onclick="app.switchGender('men')">MEN'S BRACKET <span style="opacity:0.5;font-size:0.85em;">男子</span></button>
            <button id="womenBtn" class="bracket-gender-tab${app.currentGender === 'women' ? ' active' : ''}" onclick="app.switchGender('women')">WOMEN'S BRACKET <span style="opacity:0.5;font-size:0.85em;">女子</span></button>
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
        const statsBar = `<div class="bracket-stats-bar">
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
                <span class="bracket-stat-label">CHOSEN CHAMPION</span>
                <span class="bracket-stat-value">${this.escapeHtml(championDisplay)}</span>
            </div>
            <div class="bracket-stat-card" style="cursor:help;" title="How often your picks match the most popular choice for each matchup">
                <span class="bracket-stat-label">CROWD SIMILARITY</span>
                <span class="bracket-stat-value" id="bracketSimilarity">—</span>
            </div>
            <div class="bracket-stat-card">
                <span class="bracket-stat-label">SUBMISSION DATE</span>
                <span class="bracket-stat-value">${dateStr}</span>
            </div>
        </div>`;

        // Action buttons
        const actionBtns = !isReadonly
            ? `<div class="bracket-action-btns">
                <button class="bracket-action-btn" onclick="app.saveBracket()">SUBMIT PREDICTIONS</button>
                <button class="bracket-action-btn bracket-action-gold" onclick="app.startEditing()">EDIT PICKS</button>
                <button class="bracket-action-btn" onclick="app.shareBracket()">DOWNLOAD BRACKET</button>
            </div>`
            : '';

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

        // Name + location + technique (only for own bracket)
        const savedTechnique = document.getElementById('userTechnique')?.value || '';
        const nameHtml = !isReadonly
            ? `<div class="bracket-name-row">
                <div class="bracket-name-field">
                    <label class="submit-name-label" for="submitName">Name / お名前</label>
                    <input type="text" id="submitName" class="submit-name-input" placeholder="Enter your name" maxlength="30" value="${this.escapeHtml(app.currentUser?.displayName || document.getElementById('userName')?.value || '')}" />
                </div>
                <div class="bracket-name-field">
                    <label class="submit-name-label" for="submitLocation">Country / 出身地 <span style="opacity:0.5">(optional)</span></label>
                    <select id="submitLocation" class="submit-name-input"><option value="">Select country...</option></select>
                </div>
                <div class="bracket-name-field">
                    <label class="submit-name-label" for="submitTechnique">Final winning ippon <span style="opacity:0.5">(bonus)</span></label>
                    <select id="submitTechnique" class="submit-name-input">
                        <option value="">Select ippon...</option>
                        <option value="men"${savedTechnique === 'men' ? ' selected' : ''}>Men (メ)</option>
                        <option value="kote"${savedTechnique === 'kote' ? ' selected' : ''}>Kote (コ)</option>
                        <option value="dou"${savedTechnique === 'dou' ? ' selected' : ''}>Dou (ド)</option>
                        <option value="tsuki"${savedTechnique === 'tsuki' ? ' selected' : ''}>Tsuki (ツ)</option>
                        <option value="hansoku"${savedTechnique === 'hansoku' ? ' selected' : ''}>Hansoku (ハンソク)</option>
                    </select>
                </div>
            </div>`
            : '';

        const bracketVisualHtml = `<div class="bracket-tree-wrapper">
                <div class="bracket-visual-area" id="bracketVisualArea"></div>
            </div>`;

        // Save reminder
        const reminderHtml = !isReadonly
            ? '<p class="save-reminder">⚠️ You must submit your bracket to save any changes</p>'
            : '';

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
                <div class="ad-slot" id="adBracketStats"></div>
                ${genderTabs}
                ${nameHtml}
                ${reminderHtml}
                ${incompleteHtml}
                ${resumeHtml}
                <div style="text-align:center">${legendHtml}</div>
                ${bracketVisualHtml}
                <!-- Ad slot: Below bracket tree -->
                <div class="ad-slot" id="adBelowBracket"></div>
            </div>`;
    }
};
