// Import configuration
import { rotationInterval, maxValuesToLoad } from './config.6';

// Set up some globals we need
let valuesCache;
let intervalKey;

/**
 * The code below adds the "rotate filter" menu options to applicable dashboard filter context menus
 */
prism.on('beforemenu', (ev, args) => {

    // Apply to dashboard filter context menu
	if (args.settings.name === 'dashboard-filter') {
		
        // Define a new menu item for the filter
		const rotateFilterToggle = {			
			id: 'rotate-filter',
			type: 'toggle',
            command: {
                title: 'Rotate Values',
                desc: 'Rotate the filter\'s selected value at an interval',
                canExecute: (args) => {
                    // Allow execution only for dashboard owners + only for appropriate filters
					return args.dashboard.instanceType === 'owner' && checkSingleFilter(args.filter);
                },
                execute: (args) => {
                    
                    // Stop current rotation
                    clear();
                    
                    const filterKey = getFilterDim(args.filter).key;

                    // Toggle the dashboard's rotating filter
                    if (args.dashboard.xRotatingValuesFilter && args.dashboard.xRotatingValuesFilter === filterKey) {
                        args.dashboard.xRotatingValuesFilter = '';
                    }
                    else {
                        args.dashboard.xRotatingValuesFilter = filterKey;
                    }

                    // Update the dashboard
                    args.dashboard.$dashboard.updateDashboard(args.dashboard, "xRotatingValuesFilter");

                    // Reload the page, after a few ms
                    window.location.reload();
                },
                isChecked: (args) => {

                    // Coerce flag, which may not be defined, to a boolean value
					return (args.dashboard.xRotatingValuesFilter && args.dashboard.xRotatingValuesFilter === getFilterDim(args.filter).key)
                }
            },
			commandArgs: { filter: args.settings.scope.item, dashboard: args.settings.scope.dashboard }
		};
		
        // Add the new menu item at the bottom of the menu
		args.settings.items.push(rotateFilterToggle);
	}
});

/**
 * The code below will determine whether a newly loaded dashboard has any rotating filters (that are active and valid)
 * If there are, it will load their available values, and initiate an interval to rotate them;
 */
prism.on('dashboardloaded', (ev, args) => {

    clear();

    // If no rotating value filter is defined, do nothing
    if (!args.dashboard.xRotatingValuesFilter) return;

    // Find the appropriate filter
    const rotatingFilter = args.dashboard.filters.$$items.find((item) => {
        return args.dashboard.xRotatingValuesFilter === getFilterDim(item).key;
    });

    // If the filter was not found, or it is not valid, do nothing
    if (!rotatingFilter || !checkSingleFilter(rotatingFilter)) return;

    // Initiate a dictionary of values the filter supports
    // Starting out with the current value, while the other ones load up
    valuesCache = { idx: 0, values: [rotatingFilter.jaql.filter.members[0]]};

    // Get available values for the filter
    getFilterValues(rotatingFilter, args.dashboard).then((result) => {

        // cache the results for further use
        valuesCache.values = result

    }, (err) => {
        console.error(err);
    });

    // Set interval to rotate the filter
    intervalKey = setInterval(() => {

        // Promote the index
        if (valuesCache.idx >= valuesCache.values.length - 1) valuesCache.idx = 0;
        else valuesCache.idx++;

        // Get the new value we want
        const newValue = valuesCache.values[valuesCache.idx];

        // Update the filter selected value
        rotatingFilter.jaql.filter.members = [newValue];

        // Update the dashboard filters without persisting
        args.dashboard.filters.update(rotatingFilter, {
            refresh: true,
            save: false,
            unionIfSameDimensionAndSameType: true
        });

    }, rotationInterval);
    
});

/**
 * Clear all the settings, when toggling on/off or loading a new dashboard
 */
function clear() {
    if (intervalKey) clearInterval(intervalKey);
    intervalKey = null;
    valuesCache = null;
}

/**
 * Helper function to get a filter's dimensionality correctly
 * @param {object} filter 
 */
function getFilterDim(filter) {
    if (filter.isCascading || !filter.jaql) return null;
    return {
         dim: filter.jaql.dim,
         level: filter.jaql.level,
         key: filter.jaql.dim + (filter.jaql.level ? `/${filter.jaql.level}` : '')
    };
}

/**
 * Check if a filter object is a single-selection member filter
 * @param {object} filter 
 */
function checkSingleFilter(filter) {

    // Can't be a cascading (dependant) filter
    if (filter.isCascading) return false;

    // Must be a "member" filter
    if (!filter.jaql.filter.members) return false;

    // Must be "single select" filter
    return !filter.jaql.filter.multiSelection;
}

/**
 * Execute a JAQL query to get all (first 100) possible values for a filter
 * @param {object} filter 
 * @param {object} dashboard 
 */
async function getFilterValues(filter, dashboard) {
	
    // Get the filter's dimension id
    const {dim, level} = getFilterDim(filter);

    // Get the filter's datasource
    const ds = filter.jaql.datasource || dashboard.datasource;

    // Construct a JAQL query
    const jaql = {
        datasource: ds,
        metadata: [{
            dim,
			level,
            sort: 'asc'
        }],
        offset: 0,
        count: maxValuesToLoad // Only get 100 values to keep things lightweight
    };

    // Construct the correct URL for the JAQL query
    const url = `/api/datasources/${ds.title}/jaql`;

    // Execute the JAQL query and return the values
    try {
        const response = await executeAjaxPost(url, jaql);
        return response.values;
    }
    catch (err) {
        throw err;
    }
}

/**
 * Helper function for executing AJAX POST requests
 * @param {string} url 
 * @param {object} body 
 */
async function executeAjaxPost(url, body) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url, true);
        xhr.setRequestHeader('Content-type', 'application/json');
        xhr.onreadystatechange = () => {
			if (xhr.readyState === 4) {
				if (xhr.status === 200) {
					const response = xhr.responseText;
					resolve(JSON.parse(response));
				}
				else {
					reject(xhr);
				}
			}
        };
        xhr.send(JSON.stringify(body));
    });
}
