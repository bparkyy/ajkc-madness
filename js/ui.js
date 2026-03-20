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
            ? `<div class="crowd-prediction-bar">
                <span class="crowd-label">CROWD PREDICTION</span>
                <div class="crowd-bar">
                    <div class="crowd-fill-left" style="width:${odds.p1Pct}%"></div>
                    <div class="crowd-fill-right" style="width:${odds.p2Pct}%"></div>
                </div>
                <span class="crowd-pcts">${odds.p1Pct}% vs ${odds.p2Pct}%</span>
            </div>`
            : '';

        const oddsCheckbox = `<div class="odds-toggle">
            <label><input type="checkbox" ${showOdds ? 'checked' : ''} onchange="app.toggleOdds()"> Show crowd predictions</label>
        </div>`;

        const roundTabs = ['R64', 'R32', 'R16', 'QF', 'SF', 'F'].map((label, i) => {
            const active = i === roundIndex ? ' active' : '';
            const disabled = i > 0 && !app.isRoundComplete(i - 1) ? ' disabled' : '';
            return `<button class="round-tab${active}" ${disabled ? 'disabled' : `onclick="app.jumpToRound(${i})"`}>${label}</button>`;
        }).join('');

        const finalsHeader = isFinals
            ? `<div class="finals-badge">\u2694\ufe0f \u6c7a\u52dd \u2694\ufe0f</div>`
            : '';

        return `
            <div class="game-screen${finalsClass}">
                <div class="round-tabs">${roundTabs}</div>
                ${finalsHeader}
                <div class="game-header">
                    <div class="game-round-name">${this.escapeHtml(roundName)}</div>
                    <div class="game-round-jp">${this.escapeHtml(roundNameJp || '')}</div>
                    <div class="game-match-info">Match ${matchIndex + 1} of ${totalMatches}</div>
                    <div class="game-progress"><div class="game-progress-fill" style="width:${progress}%"></div></div>
                </div>
                ${oddsCheckbox}
                ${oddsToggle}
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
                <div class="round-complete-ticker">
                    <p class="ticker-label">${picks.length} winners advance</p>
                    <div class="winner-chips">${winnersHtml}</div>
                </div>
                <button class="continue-btn" onclick="${btnAction}">${btnText}</button>
            </div>`;
    },

    // ── Bracket summary view ─────────────────────────────────────

    renderBracketSummary({ rounds, champion, isReadonly, isComplete, actualResults, viewingName }) {
        const genderLabel = app.currentGender === 'men' ? "MEN'S BRACKET" : "WOMEN'S BRACKET";
        const genderJp = app.currentGender === 'men' ? '男子' : '女子';

        // Status label
        const statusLabel = isReadonly && viewingName
            ? `<div class="bracket-status-label">${this.escapeHtml(viewingName)}'s Bracket</div>`
            : isComplete
                ? '<div class="bracket-status-label">BRACKET COMPLETED!</div>'
                : '<div class="bracket-status-label bracket-status-progress">BRACKET IN PROGRESS</div>';

        // Big title
        const titleHtml = `<h1 class="bracket-page-title">AJKC BRACKET<br>CHALLENGE</h1>`;

        // Gender tabs
        const genderTabs = `<div class="bracket-gender-tabs">
            <button id="menBtn" class="bracket-gender-tab${app.currentGender === 'men' ? ' active' : ''}" onclick="app.switchGender('men')">MEN'S BRACKET</button>
            <button id="womenBtn" class="bracket-gender-tab${app.currentGender === 'women' ? ' active' : ''}" onclick="app.switchGender('women')">WOMEN'S BRACKET</button>
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
        const precisionPct = totalActual > 0 ? Math.round((correctPicks / totalActual) * 100) : 0;
        const dateStr = app._submissionDate
            ? app._submissionDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase()
            : 'NOT YET';
        const championDisplay = champion || '\u2014';
        const statsBar = `<div class="bracket-stats-bar">
            <div class="bracket-stat-card">
                <span class="bracket-stat-label">CORRECT PICKS</span>
                <span class="bracket-stat-value">${actualResults ? correctPicks + ' / ' + totalActual : '\u2014'}</span>
            </div>
            <div class="bracket-stat-card">
                <span class="bracket-stat-label">PRECISION RATE</span>
                <span class="bracket-stat-value">${actualResults ? precisionPct + '%' : '\u2014'}</span>
            </div>
            <div class="bracket-stat-card">
                <span class="bracket-stat-label">POINTS SCORED</span>
                <span class="bracket-stat-value">${actualResults ? totalPoints : '\u2014'}</span>
            </div>
            <div class="bracket-stat-card">
                <span class="bracket-stat-label">CHOSEN CHAMPION</span>
                <span class="bracket-stat-value">${this.escapeHtml(championDisplay)}</span>
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
                    <label class="submit-name-label" for="submitTechnique">Final winning technique <span style="opacity:0.5">(tiebreaker)</span></label>
                    <select id="submitTechnique" class="submit-name-input">
                        <option value="">Select technique...</option>
                        <option value="men"${savedTechnique === 'men' ? ' selected' : ''}>Men (面)</option>
                        <option value="kote"${savedTechnique === 'kote' ? ' selected' : ''}>Kote (小手)</option>
                        <option value="do"${savedTechnique === 'do' ? ' selected' : ''}>Do (胴)</option>
                        <option value="tsuki"${savedTechnique === 'tsuki' ? ' selected' : ''}>Tsuki (突き)</option>
                        <option value="hansoku"${savedTechnique === 'hansoku' ? ' selected' : ''}>Hansoku (反則)</option>
                    </select>
                </div>
            </div>`
            : '';

        const bracketVisualHtml = `<div class="bracket-tree-wrapper">
                <div class="bracket-visual-area" id="bracketVisualArea"></div>
            </div>`;

        // Scoring breakdown cards
        const scoringHtml = `<div class="bracket-scoring-section">
            <h3 class="bracket-scoring-title">SCORING BREAKDOWN</h3>
            <div class="bracket-scoring-cards">
                <div class="bracket-scoring-card"><span class="bsc-pts">1 PT</span><span class="bsc-round">ROUND OF 64</span></div>
                <div class="bracket-scoring-card"><span class="bsc-pts">2 PTS</span><span class="bsc-round">ROUND OF 32</span></div>
                <div class="bracket-scoring-card"><span class="bsc-pts">4 PTS</span><span class="bsc-round">ROUND OF 16</span></div>
                <div class="bracket-scoring-card"><span class="bsc-pts">8 PTS</span><span class="bsc-round">QF</span></div>
                <div class="bracket-scoring-card"><span class="bsc-pts">16 PTS</span><span class="bsc-round">SF</span></div>
                <div class="bracket-scoring-card bracket-scoring-highlight"><span class="bsc-pts">32 PTS</span><span class="bsc-round">FINALS</span></div>
                <div class="bracket-scoring-card bracket-scoring-highlight"><span class="bsc-pts">+5 PTS</span><span class="bsc-round">TECHNIQUE</span></div>
            </div>
            <div class="bracket-tiebreaker-info">
                <h4 class="bracket-scoring-title" style="font-size:1em;margin-top:16px">TIEBREAKERS</h4>
                <div class="tiebreaker-list">
                    <div class="tiebreaker-item"><span>Earlier bracket submission wins</span></div>
                </div>
            </div>
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
                ${genderTabs}
                ${nameHtml}
                ${reminderHtml}
                ${incompleteHtml}
                ${resumeHtml}
                <div style="text-align:center">${legendHtml}</div>
                ${bracketVisualHtml}
                ${scoringHtml}
            </div>`;
    }
};
