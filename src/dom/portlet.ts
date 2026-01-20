/**
 * Add or update a portlet link in the actions menu (fallback to toolbox).
 * @param portletId - The HTML id attribute for the portlet link.
 * @param label - The text label for the portlet link.
 * @param onClick - Click handler function for the portlet link.
 */
export function addPortletTrigger(portletId: string, label: string, onClick: () => void): void {
	const targets = ['p-cactions', 'p-tb'];
	let li = document.getElementById(portletId) as HTMLLIElement | null;

	if (!li) {
		for (const target of targets) {
			const added = mw.util.addPortletLink(target, '#', label, portletId, label);
			if (added) {
				li = added;
				break;
			}
		}
	}

	if (!li) return;

	const link = li.querySelector('a');

	// Update text/label if present
	if (link) {
		link.textContent = label;
		link.title = label;
		link.href = '#';
	}

	// Remove previous listeners (avoid stacking)
	const cloned = li.cloneNode(true);
	li.replaceWith(cloned);
	const freshLi = document.getElementById(portletId);
	const freshLink = freshLi?.querySelector('a');

	const handler = (event: Event) => {
		event.preventDefault();
		onClick();
	};

	if (freshLink) {
		freshLink.addEventListener('click', handler);
		freshLink.addEventListener('keydown', (event: KeyboardEvent) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				onClick();
			}
		});
	} else if (freshLi) {
		freshLi.addEventListener('click', handler);
	}
}