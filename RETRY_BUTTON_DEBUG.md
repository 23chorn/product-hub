# Retry Button - Debug Guide

## Where the Button Should Appear

The retry button (`↻`) should appear **on the same line as the stage name**, immediately after it, when:
1. The stage status is `in-progress` (animated ▶ icon showing)
2. The user is an admin (or `noAuth` mode is enabled)

### Visual Layout

```
Pipeline Stages:

○ Coordinator                      ← Not running (no button)
✓ Research Brief                   ← Complete (no button)
✓ PRD                              ← Complete (no button)
▶ Solution Architect [↻]          ← RUNNING (button should be HERE)
  Atlas is writing...              ← Animation below
○ Story Decomposition              ← Not started (no button)
○ Curator                          ← Not started (no button)
```

The button should be:
- **Small**: 10px font
- **Subtle gray**: `text-slate-600` 
- **Bordered**: thin border with `border-slate-700/50`
- **Hover effect**: turns amber (`text-amber-500`)
- **Symbol**: `↻` (circular arrow)

## Debug Steps

### 1. Open Browser Console
Press `F12` or right-click → Inspect → Console tab

### 2. Check Debug Logs
You should see these logs when viewing a workflow with a running stage:

```
[RETRY DEBUG] isAdmin: true noAuth: false realUser: {...}
```

If `isAdmin` is `false`, the button won't show!

### 3. Check for Button Visibility Logs
When a stage is running, you should see one of:
- `[RETRY] Button hidden - onRetryStage is undefined for: solution_architect` (button won't show)
- Nothing (button is showing)

### 4. Force Admin Mode
If you need to test the button and you're not an admin, you can:

**Option A: Enable noAuth mode**
1. Go to settings (gear icon)
2. Find "Authentication" section
3. Enable "No Authentication" mode
4. Refresh the page

**Option B: Temporarily modify the code**
In `PipelineTerminalView.tsx`, change:
```typescript
const isAdmin = noAuth || realUser?.is_admin;
```
To:
```typescript
const isAdmin = true; // TEMP: force admin mode
```

### 5. Ensure Frontend is Updated
If you made changes while the dev server was running:
1. Save all files
2. Wait for Vite HMR to reload (check console for `[vite] hmr update`)
3. Hard refresh: `Ctrl+Shift+R` (Windows) or `Cmd+Shift+R` (Mac)
4. Or restart dev server: `npm run dev`

### 6. Check Stage Status
The button only shows when `status === 'in-progress'`. Verify:
- The stage has the animated `▶` icon (not `○` or `✓`)
- The stage name is highlighted in teal color
- There's an animation or progress message below the stage name

### 7. Inspect the DOM
Right-click on the stage name → Inspect Element. You should see:

```html
<div class="flex items-center gap-2 min-w-0">
  <span class="block text-[13px] font-mono...">
    Solution Architect
  </span>
  <!-- Button should be HERE if conditions are met -->
  <button class="flex-shrink-0 text-[10px] px-1 py-0.5...">
    ↻
  </button>
</div>
```

If the button element is missing, check the console logs to see why.

## Common Issues

### Issue 1: Not an Admin
**Symptom**: Console shows `isAdmin: false`
**Solution**: Enable noAuth mode in settings, or ask an admin to give you admin role

### Issue 2: Stage Not Running
**Symptom**: Stage shows `○` or `✓` icon instead of `▶`
**Solution**: Wait for a stage to start running, or manually trigger a workflow

### Issue 3: Frontend Not Updated
**Symptom**: Console logs don't appear at all
**Solution**: Hard refresh or restart dev server

### Issue 4: Button Hidden by CSS
**Symptom**: Button exists in DOM but not visible
**Solution**: Check for CSS issues with `overflow: hidden` on parent

## Test the Button Works

Once you can see the button:
1. Hover over it - should turn amber
2. Tooltip should show: "Restart this stage from the beginning"
3. Click it - console should show: `[RETRY] Button clicked for stage: solution_architect`
4. Stage should restart from scratch (new events appear)

## Remove Debug Logs

Once confirmed working, remove the console.log statements from:
- `StageRow.tsx` (lines with `console.log('[RETRY]...`)
- `PipelineTerminalView.tsx` (the useEffect with debug logging)
