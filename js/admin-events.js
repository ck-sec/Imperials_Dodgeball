/* ═══════════════════════════════════════
   ADMIN EVENTS — Vienna Imperials
   Replaces inline handlers for CSP compliance
═══════════════════════════════════════ */

// Skip-to-content link
var skipLink = document.getElementById('skipLink');
if (skipLink) {
  skipLink.addEventListener('focus', function() { this.style.top = '0'; });
  skipLink.addEventListener('blur', function() { this.style.top = '-40px'; });
}

// Nav
document.getElementById('adminLogoutBtn').addEventListener('click', function() { adminLogout(); });
document.getElementById('loginBtn').addEventListener('click', function() { attemptAdminLogin(); });

// Dashboard tabs
document.querySelectorAll('.dash-tab[data-tab]').forEach(function(btn) {
  btn.addEventListener('click', function() { switchAdminDashTab(btn.dataset.tab, btn); });
});

// Members
document.getElementById('refreshMembersBtn').addEventListener('click', function() { loadPendingMembers(); });
document.getElementById('refreshMemberManagementBtn').addEventListener('click', function() { loadMemberManagement(); });

// Training tab
document.getElementById('createSessionBtn').addEventListener('click', function() { openCreateSessionModal(); });
document.getElementById('openRecurringBtn').addEventListener('click', function() { openRecurringModal(); });
document.querySelectorAll('.at-tab[data-tab]').forEach(function(btn) {
  btn.addEventListener('click', function() { switchAdminTrainingTab(btn.dataset.tab, btn); });
});

// Rankings toolbar
document.getElementById('exportCsvBtn').addEventListener('click', function() { exportCSV(); });
document.getElementById('openImportBtn').addEventListener('click', function() { openImport(); });
document.getElementById('addPlayerBtn').addEventListener('click', function() { openModal(); });

// Player modal
document.getElementById('modalBackdrop').addEventListener('click', function(e) { if (e.target === this) closeModal(); });
document.getElementById('closeModalBtn').addEventListener('click', function() { closeModal(); });
document.getElementById('cancelModalBtn').addEventListener('click', function() { closeModal(); });
document.getElementById('playerForm').addEventListener('submit', function(e) {
  savePlayer(e).catch(function(error) {
    if (error.message === 'ADMIN_SESSION_EXPIRED') return;
    console.error('Ranking player save failed:', error);
    toast(error.message || 'Player changes could not be saved.', 'danger');
  });
});

// Delete confirm modal
document.getElementById('confirmBackdrop').addEventListener('click', function(e) { if (e.target === this) closeConfirm(); });
document.getElementById('closeConfirmBtn').addEventListener('click', function() { closeConfirm(); });
document.getElementById('cancelConfirmBtn').addEventListener('click', function() { closeConfirm(); });
document.getElementById('confirmDeleteBtn').addEventListener('click', function() { confirmDelete(); });

// Import modal
document.getElementById('importBackdrop').addEventListener('click', function(e) { if (e.target === this) closeImport(); });
document.getElementById('closeImportBtn').addEventListener('click', function() { closeImport(); });
document.getElementById('cancelImportBtn').addEventListener('click', function() { closeImport(); });
document.getElementById('importConfirmBtn').addEventListener('click', function() { confirmImport(); });
document.getElementById('fileInput').addEventListener('change', function(e) { handleFileSelect(e); });
document.querySelectorAll('.import-mode-btn[data-mode]').forEach(function(btn) {
  btn.addEventListener('click', function() { setImportMode(btn.dataset.mode); });
});

// Session modal
document.getElementById('atSessionModal').addEventListener('click', function(e) { if (e.target === this) closeSessionModal(); });
document.getElementById('atSubmitBtn').addEventListener('click', function() { submitSession(); });
document.getElementById('cancelSessionBtn').addEventListener('click', function() { closeSessionModal(); });

// Recurring modal
document.getElementById('atRecurringModal').addEventListener('click', function(e) { if (e.target === this) closeRecurringModal(); });
document.getElementById('atRecSubmitBtn').addEventListener('click', function() { submitRecurring(); });
document.getElementById('cancelRecurringBtn').addEventListener('click', function() { closeRecurringModal(); });
