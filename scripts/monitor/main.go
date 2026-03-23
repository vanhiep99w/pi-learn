package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// ── Data ──────────────────────────────────────────────────────────

type Task struct {
	ID        string   `json:"id"`
	Title     string   `json:"title"`
	Status    string   `json:"status"`
	Agent     string   `json:"agent"`
	StartedAt int64    `json:"started_at"`
	Result    string   `json:"result"`
	Error     string   `json:"error"`
	DependsOn []string `json:"depends_on"`
}

type TaskBoard struct {
	Team      string `json:"team"`
	UpdatedAt int64  `json:"updated_at"`
	Tasks     []Task `json:"tasks"`
}

type TeamInfo struct {
	Name    string
	ModTime time.Time
	Board   *TaskBoard
	Logs    []string
}

// ── Colors ────────────────────────────────────────────────────────

var (
	cPurple     = lipgloss.Color("#9F7AEA")
	cCyan       = lipgloss.Color("#38BDF8")
	cGreen      = lipgloss.Color("#4ADE80")
	cYellow     = lipgloss.Color("#FBBF24")
	cRed        = lipgloss.Color("#F87171")
	cGray       = lipgloss.Color("#6B7280")
	cDim        = lipgloss.Color("#374151")
	cBorder     = lipgloss.Color("#2D2B55")
	cText       = lipgloss.Color("#E2E8F0")
	cSidebarSel = lipgloss.Color("#1E1E3A")

	sIcon = map[string]string{
		"done": "✓", "in_progress": "⏳", "assigned": "⏳",
		"ready": "◎", "pending": "○", "failed": "✗",
		"blocked": "⊘", "waiting_approval": "⏸",
	}
	sColor = map[string]lipgloss.Color{
		"done": cGreen, "in_progress": cYellow, "assigned": cYellow,
		"ready": cCyan, "pending": cGray, "failed": cRed,
		"blocked": cRed, "waiting_approval": cPurple,
	}
)

// ── Model ─────────────────────────────────────────────────────────

type tickMsg time.Time

type model struct {
	teamsDir string
	teams    []TeamInfo
	cursor   int // sidebar selection
	logVP    viewport.Model
	w, h     int
	focused  string // "sidebar" | "logs"
	autoScroll bool
}

const sidebarW = 26

func initialModel(teamsDir string) model {
	vp := viewport.New(80, 20)
	m := model{
		teamsDir:   teamsDir,
		logVP:      vp,
		focused:    "sidebar",
		autoScroll: true,
	}
	m.refreshTeams()
	return m
}

func (m *model) refreshTeams() {
	entries, err := os.ReadDir(m.teamsDir)
	if err != nil {
		return
	}

	var teams []TeamInfo
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		ti := TeamInfo{Name: e.Name(), ModTime: info.ModTime()}

		boardFile := filepath.Join(m.teamsDir, e.Name(), "tasks.json")
		if data, err := os.ReadFile(boardFile); err == nil {
			var b TaskBoard
			if json.Unmarshal(data, &b) == nil {
				ti.Board = &b
			}
		}

		logFile := filepath.Join(m.teamsDir, e.Name(), "aurora.log")
		if data, err := os.ReadFile(logFile); err == nil {
			lines := strings.Split(strings.TrimSpace(string(data)), "\n")
			if len(lines) == 1 && lines[0] == "" {
				lines = nil
			}
			ti.Logs = lines
		}
		teams = append(teams, ti)
	}

	sort.Slice(teams, func(i, j int) bool {
		return teams[i].ModTime.After(teams[j].ModTime)
	})
	m.teams = teams

	if m.cursor >= len(m.teams) {
		m.cursor = maxInt(0, len(m.teams)-1)
	}
}

func (m model) Init() tea.Cmd {
	return tea.Tick(2*time.Second, func(t time.Time) tea.Msg { return tickMsg(t) })
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.w = msg.Width
		m.h = msg.Height
		m.resizeVP()

	case tickMsg:
		m.refreshTeams()
		m.rebuildLogContent()
		cmds = append(cmds, tea.Tick(2*time.Second, func(t time.Time) tea.Msg { return tickMsg(t) }))

	case tea.KeyMsg:
		switch msg.String() {
		case "q", "ctrl+c":
			return m, tea.Quit

		// ── Focus switch: Tab / Left / Right ─────────────
		case "tab", "right", "l":
			if m.focused == "sidebar" {
				m.focused = "logs"
			}
		case "shift+tab", "left", "h":
			if m.focused == "logs" {
				m.focused = "sidebar"
			}

		// ── Navigate ─────────────────────────────────────
		case "up", "k":
			if m.focused == "sidebar" {
				if m.cursor > 0 {
					m.cursor--
					m.autoScroll = true
					m.rebuildLogContent()
				}
			} else {
				m.autoScroll = false
				var cmd tea.Cmd
				m.logVP, cmd = m.logVP.Update(msg)
				cmds = append(cmds, cmd)
			}

		case "down", "j":
			if m.focused == "sidebar" {
				if m.cursor < len(m.teams)-1 {
					m.cursor++
					m.autoScroll = true
					m.rebuildLogContent()
				}
			} else {
				var cmd tea.Cmd
				m.logVP, cmd = m.logVP.Update(msg)
				cmds = append(cmds, cmd)
				// If scrolled to bottom, re-enable auto-scroll
				if m.logVP.AtBottom() {
					m.autoScroll = true
				}
			}

		case "G":
			if m.focused == "logs" {
				m.logVP.GotoBottom()
				m.autoScroll = true
			}
		case "g":
			if m.focused == "logs" {
				m.logVP.GotoTop()
				m.autoScroll = false
			}

		case "r":
			m.refreshTeams()
			m.rebuildLogContent()

		case "pgdown":
			if m.focused == "logs" {
				m.autoScroll = false
				var cmd tea.Cmd
				m.logVP, cmd = m.logVP.Update(msg)
				cmds = append(cmds, cmd)
				if m.logVP.AtBottom() {
					m.autoScroll = true
				}
			}
		case "pgup":
			if m.focused == "logs" {
				m.autoScroll = false
				var cmd tea.Cmd
				m.logVP, cmd = m.logVP.Update(msg)
				cmds = append(cmds, cmd)
			}

		// ── Control commands → ghi control.json ─────
		case "s": // Stop team
			if m.cursor < len(m.teams) {
				m.sendControl(m.teams[m.cursor].Name, map[string]any{"action": "stop"})
			}

		case "x": // Kill running agent(s)
			if m.cursor < len(m.teams) {
				m.sendControl(m.teams[m.cursor].Name, map[string]any{"action": "kill"})
			}

		case "m": // Broadcast message
			// TODO: input dialog (for now, hardcode a nudge)
			if m.cursor < len(m.teams) {
				m.sendControl(m.teams[m.cursor].Name, map[string]any{
					"action":  "message",
					"content": "User nudge: hãy tập trung vào task chính, tránh thay đổi không cần thiết",
				})
			}

		default:
			if m.focused == "logs" {
				var cmd tea.Cmd
				m.logVP, cmd = m.logVP.Update(msg)
				cmds = append(cmds, cmd)
			}
		}

	case tea.MouseMsg:
		// Mouse wheel scroll cho Live Activity panel
		switch msg.Button {
		case tea.MouseButtonWheelUp:
			m.focused = "logs"
			m.autoScroll = false
			m.logVP.LineUp(3)
		case tea.MouseButtonWheelDown:
			m.focused = "logs"
			m.logVP.LineDown(3)
			if m.logVP.AtBottom() {
				m.autoScroll = true
			}
		}
	}

	return m, tea.Batch(cmds...)
}

func (m *model) resizeVP() {
	contentW := m.w - sidebarW - 4
	// Task board gets fixed height, logs get the rest
	taskH := m.taskBoardHeight()
	logH := m.h - 4 - taskH - 4 // header+footer+borders+task panel
	if logH < 5 {
		logH = 5
	}
	if contentW < 20 {
		contentW = 20
	}
	m.logVP.Width = contentW
	m.logVP.Height = logH
}

func (m *model) taskBoardHeight() int {
	if m.cursor >= len(m.teams) || m.teams[m.cursor].Board == nil {
		return 3
	}
	tasks := m.teams[m.cursor].Board.Tasks
	h := len(tasks) + 2 // tasks + summary + separator
	for _, t := range tasks {
		if (t.Status == "done" && t.Result != "") ||
			((t.Status == "failed" || t.Status == "blocked") && t.Error != "") {
			h++
		}
	}
	if h > 12 {
		h = 12
	}
	return h
}

func (m *model) rebuildLogContent() {
	if m.cursor >= len(m.teams) {
		m.logVP.SetContent(dim("  (no team selected)"))
		return
	}
	ti := m.teams[m.cursor]

	var sb strings.Builder
	if len(ti.Logs) == 0 {
		sb.WriteString(dim("  (no logs yet)"))
	} else {
		for _, line := range ti.Logs {
			sb.WriteString("  " + colorLog(line) + "\n")
		}
	}

	m.logVP.SetContent(sb.String())
	if m.autoScroll {
		m.logVP.GotoBottom()
	}
}

// ── View ──────────────────────────────────────────────────────────

func (m model) View() string {
	if m.w == 0 {
		return "Loading..."
	}

	// ── Header ──────────────────────────────────
	header := lipgloss.NewStyle().
		Background(lipgloss.Color("#1A1A2E")).
		Foreground(cCyan).Bold(true).
		Width(m.w).Padding(0, 1).
		Render(fmt.Sprintf("🌌 Aurora Teams Monitor  ·  %d teams  ·  %s",
			len(m.teams), time.Now().Format("15:04:05")))

	// ── Sidebar ─────────────────────────────────
	sideH := m.h - 3
	var sideLines []string

	titleStyle := lipgloss.NewStyle().Foreground(cPurple).Bold(true).
		Width(sidebarW - 2).Align(lipgloss.Center)
	sideLines = append(sideLines, titleStyle.Render("Teams"))
	sideLines = append(sideLines,
		lipgloss.NewStyle().Foreground(cBorder).Render(strings.Repeat("─", sidebarW-2)))

	for i, ti := range m.teams {
		status := teamStatusIcon(ti)
		name := ti.Name
		if len(name) > sidebarW-8 {
			name = name[:sidebarW-8]
		}
		age := shortAge(ti.ModTime)
		line := fmt.Sprintf(" %s %s", status, name)

		var style lipgloss.Style
		if i == m.cursor {
			if m.focused == "sidebar" {
				style = lipgloss.NewStyle().
					Background(cSidebarSel).Foreground(cCyan).Bold(true).
					Width(sidebarW - 2)
			} else {
				style = lipgloss.NewStyle().
					Background(lipgloss.Color("#151525")).Foreground(cText).
					Width(sidebarW - 2)
			}
		} else {
			style = lipgloss.NewStyle().Foreground(cGray).Width(sidebarW - 2)
		}

		ageStr := lipgloss.NewStyle().Foreground(cDim).Render(age)
		pad := sidebarW - 2 - lipgloss.Width(line) - lipgloss.Width(age) - 1
		if pad < 1 {
			pad = 1
		}
		sideLines = append(sideLines, style.Render(line+strings.Repeat(" ", pad)+ageStr))
	}

	for len(sideLines) < sideH {
		sideLines = append(sideLines, lipgloss.NewStyle().Width(sidebarW-2).Render(""))
	}

	sidebarBorderColor := cBorder
	if m.focused == "sidebar" {
		sidebarBorderColor = cCyan
	}
	sidebar := lipgloss.NewStyle().
		Width(sidebarW).
		Height(sideH).
		Border(lipgloss.RoundedBorder()).
		BorderForeground(sidebarBorderColor).
		Render(strings.Join(sideLines[:minInt(sideH, len(sideLines))], "\n"))

	// ── Right side: TaskBoard (fixed) + Logs (scrollable) ───
	contentW := m.w - sidebarW - 4 // borders
	if contentW < 20 {
		contentW = 20
	}

	// Task Board — fixed, never scrolls
	taskBoardStr := m.renderTaskBoard(contentW)
	taskPanel := lipgloss.NewStyle().
		Width(contentW + 2).
		Border(lipgloss.RoundedBorder()).
		BorderForeground(cBorder).
		Render(taskBoardStr)

	// Logs — scrollable viewport
	m.resizeVP()
	m.rebuildLogContent()

	logBorderColor := cBorder
	if m.focused == "logs" {
		logBorderColor = cCyan
	}

	scrollInfo := ""
	if len(m.teams) > 0 && m.cursor < len(m.teams) && len(m.teams[m.cursor].Logs) > 0 {
		pct := m.logVP.ScrollPercent()
		scrollInfo = fmt.Sprintf(" %d%%", int(pct*100))
		if m.autoScroll {
			scrollInfo += " 🔄"
		}
	}

	logTitle := lipgloss.NewStyle().Foreground(cCyan).Bold(true).
		Render("📡 Live Activity") +
		lipgloss.NewStyle().Foreground(cDim).Render(scrollInfo)

	logPanel := lipgloss.NewStyle().
		Width(contentW + 2).
		Border(lipgloss.RoundedBorder()).
		BorderForeground(logBorderColor).
		Render(logTitle + "\n" + m.logVP.View())

	rightSide := lipgloss.JoinVertical(lipgloss.Left, taskPanel, logPanel)

	// ── Join ────────────────────────────────────
	body := lipgloss.JoinHorizontal(lipgloss.Top, sidebar, rightSide)

	// ── Footer ──────────────────────────────────
	focusLabel := lipgloss.NewStyle().Foreground(cPurple).Bold(true).Render(m.focused)
	footer := lipgloss.NewStyle().
		Foreground(cGray).Width(m.w).Padding(0, 1).
		Render(fmt.Sprintf("%s quit  %s navigate  %s switch  %s stop  %s kill  %s msg  %s refresh  · %s",
			colored("[q]", cCyan),
			colored("[↑↓]", cCyan),
			colored("[←→]", cCyan),
			colored("[s]", cRed),
			colored("[x]", cRed),
			colored("[m]", cYellow),
			colored("[r]", cCyan),
			focusLabel,
		))

	return header + "\n" + body + "\n" + footer
}

func (m model) renderTaskBoard(w int) string {
	title := lipgloss.NewStyle().Foreground(cCyan).Bold(true).
		Render("📋 Task Board")

	if m.cursor >= len(m.teams) {
		return title + "\n" + dim("  (no team)")
	}
	ti := m.teams[m.cursor]
	if ti.Board == nil || len(ti.Board.Tasks) == 0 {
		return title + "\n" + dim("  (no tasks)")
	}

	var sb strings.Builder
	sb.WriteString(title + "\n")

	now := time.Now().UnixMilli()
	for _, t := range ti.Board.Tasks {
		col, ok := sColor[t.Status]
		if !ok {
			col = cText
		}
		icon, ok := sIcon[t.Status]
		if !ok {
			icon = "?"
		}
		st := lipgloss.NewStyle().Foreground(col)

		elapsed := ""
		if t.StartedAt > 0 && (t.Status == "in_progress" || t.Status == "assigned") {
			s := (now - t.StartedAt) / 1000
			if s < 60 {
				elapsed = fmt.Sprintf(" %ds", s)
			} else {
				elapsed = fmt.Sprintf(" %dm%ds", s/60, s%60)
			}
		}

		agent := ""
		if t.Agent != "" {
			agent = lipgloss.NewStyle().Foreground(cPurple).Render(" ["+t.Agent+"]")
		}

		taskTitle := t.Title
		maxTitleW := w - 20
		if maxTitleW > 0 && len(taskTitle) > maxTitleW {
			taskTitle = taskTitle[:maxTitleW] + "…"
		}

		sb.WriteString(fmt.Sprintf(" %s %s%s%s\n",
			st.Bold(true).Render(icon),
			st.Render(taskTitle),
			agent,
			lipgloss.NewStyle().Foreground(cYellow).Render(elapsed),
		))

		if t.Status == "done" && t.Result != "" {
			preview := firstLine(t.Result, minInt(w-8, 90))
			if preview != "" {
				sb.WriteString(dim("     └ "+preview) + "\n")
			}
		}
		if (t.Status == "failed" || t.Status == "blocked") && t.Error != "" {
			e := t.Error
			if len(e) > minInt(w-8, 90) {
				e = e[:minInt(w-8, 90)] + "..."
			}
			sb.WriteString(lipgloss.NewStyle().Foreground(cRed).Render("     └ "+e) + "\n")
		}
	}

	// Summary
	counts := map[string]int{}
	for _, t := range ti.Board.Tasks {
		counts[t.Status]++
	}
	parts := []string{}
	if n := counts["done"]; n > 0 {
		parts = append(parts, colored(fmt.Sprintf("✓%d", n), cGreen))
	}
	if n := counts["in_progress"] + counts["assigned"]; n > 0 {
		parts = append(parts, colored(fmt.Sprintf("⏳%d", n), cYellow))
	}
	if n := counts["pending"]; n > 0 {
		parts = append(parts, colored(fmt.Sprintf("○%d", n), cGray))
	}
	if n := counts["failed"] + counts["blocked"]; n > 0 {
		parts = append(parts, colored(fmt.Sprintf("✗%d", n), cRed))
	}
	sb.WriteString(" " + strings.Join(parts, " "))

	return sb.String()
}

// ── Helpers ───────────────────────────────────────────────────────

func teamStatusIcon(ti TeamInfo) string {
	if ti.Board == nil {
		return lipgloss.NewStyle().Foreground(cGray).Render("○")
	}
	counts := map[string]int{}
	for _, t := range ti.Board.Tasks {
		counts[t.Status]++
	}
	if counts["failed"]+counts["blocked"] > 0 {
		return lipgloss.NewStyle().Foreground(cRed).Render("✗")
	}
	if counts["in_progress"]+counts["assigned"] > 0 {
		return lipgloss.NewStyle().Foreground(cYellow).Render("⏳")
	}
	if counts["done"] == len(ti.Board.Tasks) && len(ti.Board.Tasks) > 0 {
		return lipgloss.NewStyle().Foreground(cGreen).Render("✓")
	}
	return lipgloss.NewStyle().Foreground(cGray).Render("○")
}

func shortAge(t time.Time) string {
	d := time.Since(t)
	switch {
	case d < time.Minute:
		return fmt.Sprintf("%ds", int(d.Seconds()))
	case d < time.Hour:
		return fmt.Sprintf("%dm", int(d.Minutes()))
	case d < 24*time.Hour:
		return fmt.Sprintf("%dh", int(d.Hours()))
	default:
		return fmt.Sprintf("%dd", int(d.Hours()/24))
	}
}

func colorLog(line string) string {
	switch {
	case strings.Contains(line, "✓"):
		return lipgloss.NewStyle().Foreground(cGreen).Render(line)
	case strings.Contains(line, "✗") || strings.Contains(line, "error") || strings.Contains(line, "failed"):
		return lipgloss.NewStyle().Foreground(cRed).Render(line)
	case strings.Contains(line, "▸"):
		return lipgloss.NewStyle().Foreground(cYellow).Render(line)
	case strings.Contains(line, "⟳"):
		return lipgloss.NewStyle().Foreground(cPurple).Render(line)
	case strings.Contains(line, "📖") || strings.Contains(line, "✏") ||
		strings.Contains(line, "🔍") || strings.Contains(line, "🖥") ||
		strings.Contains(line, "📂") || strings.Contains(line, "🔎") ||
		strings.Contains(line, "↳"):
		return lipgloss.NewStyle().Foreground(cCyan).Render(line)
	case strings.Contains(line, "💭") || strings.Contains(line, "thinking"):
		return lipgloss.NewStyle().Foreground(cPurple).Italic(true).Render(line)
	case strings.Contains(line, "💬"):
		return lipgloss.NewStyle().Foreground(cText).Render(line)
	default:
		return lipgloss.NewStyle().Foreground(cText).Render(line)
	}
}

func firstLine(text string, maxLen int) string {
	for _, l := range strings.Split(text, "\n") {
		l = strings.TrimSpace(l)
		if l != "" && !strings.HasPrefix(l, "#") && !strings.HasPrefix(l, "---") {
			if len(l) > maxLen {
				l = l[:maxLen] + "..."
			}
			return l
		}
	}
	return ""
}

func (m *model) sendControl(teamName string, cmd map[string]any) {
	controlPath := filepath.Join(m.teamsDir, teamName, "control.json")
	data, err := json.Marshal(cmd)
	if err != nil {
		return
	}
	_ = os.WriteFile(controlPath, data, 0644)
}

func dim(s string) string    { return lipgloss.NewStyle().Foreground(cDim).Render(s) }
func colored(s string, c lipgloss.Color) string {
	return lipgloss.NewStyle().Foreground(c).Render(s)
}
func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// ── Main ──────────────────────────────────────────────────────────

func findTeamsDir(startDir string) string {
	cur := startDir
	for {
		piDir := filepath.Join(cur, ".pi")
		if _, err := os.Stat(piDir); err == nil {
			td := filepath.Join(piDir, "teams")
			_ = os.MkdirAll(td, 0755)
			return td
		}
		parent := filepath.Dir(cur)
		if parent == cur {
			break
		}
		cur = parent
	}
	return filepath.Join(startDir, ".pi", "teams")
}

func main() {
	cwd, _ := os.Getwd()
	teamsDir := findTeamsDir(cwd)

	p := tea.NewProgram(
		initialModel(teamsDir),
		tea.WithAltScreen(),
		tea.WithMouseCellMotion(),
	)

	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}
