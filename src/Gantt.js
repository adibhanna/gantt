/*

Opts:
	parent_selector: [reqd]
	label_width: default 200
	step: 24 // no of hours
	column_width: 15 // pixels
	date_format: 'YYYY-MM-DD'
	bar.height: 26
	arrow.curve: 15

*/

var Gantt = Class.extend({
	init: function(opts) {
		this.opts = opts;
		this.events = this.opts.events;
		this.set_defaults();
		this.prepare();
		this.render();
	},
	set_defaults: function() {
		var defaults = {
			label_width: 38,
			header_height: 50,
			column_width: 30,
			step: 24,
			valid_view_modes: [
				"Quarter Day",
				"Half Day",
				"Day",
				"Week",
				"Month"
			],
			bar: {
				height: 20
			},
			arrow: {
				curve: 5
			},
			view_mode: 'Day',
			padding: 18,
			date_format: 'DD-MM-YYYY'
		};
		for(var key in defaults) {
			if(defaults.hasOwnProperty(key)) {
				if(!this.opts[key]) this.opts[key] = defaults[key];
			}
		}

		this._bars = [];
		this._arrows = [];
		this.groups = {};

		//prepare tasks
		var me = this;
		this.tasks = this.opts.tasks.map(function(task, i) {
			// momentify
			task._start = moment(task.start, me.opts.date_format);
			task._end = moment(task.end, me.opts.date_format);
			//index
			task._index = i;
			//invalid dates
			if(!task.start || !task.end) {
				task._start = moment().startOf('day');
				task._end = moment().startOf('day').add(2, 'days');
				task.invalid = true;
			}
			return task;
		});
		//default view mode
		this.set_scale(this.opts.view_mode);
	},
	prepare: function() {
		//TODO: check for valid dates
		this.start = this.end = undefined;
		this.prepare_dates();
		this.render_canvas();
	},
	render: function() {
		this.clear();
		this.setup_groups();
		this.make_grid();
		this.make_dates();
		this.make_bars();
		this.make_arrows();
		this.set_arrows_on_bars();
		this.setup_events();
		this.set_width();
		this.set_scroll_position();
		this.bind();
	},
	bind: function() {
		this.bind_grid_click();
	},
	render_canvas: function() {
		this.canvas = Snap(this.opts.parent_selector);
		this.canvas.addClass("gantt");
	},
	clear: function () {
		this.canvas.clear();
		this._bars = [];
		this._arrows = [];
	},
	prepare_dates: function() {
		var me = this;
		this.tasks.forEach(function(task) {
			// set global start and end date
			if(!me.start || task._start < me.start) {
				me.start = task._start;
			}
			if(!me.end || task._end > me.end) {
				me.end = task._end;
			}
		});
		this.set_gantt_dates();
		this.setup_dates();
	},
	set_gantt_dates: function() {
		var me = this;
		if(me.view_is(['Quarter Day','Half Day'])) {
			me.start = me.start.clone().subtract(7, 'day');
			me.end = me.end.clone().add(7, 'day');
		} else if(me.view_is('Month')) {
			me.start = me.start.clone().startOf('year');
			me.end = me.end.clone().endOf('month').add(1, 'year');
		} else {
			me.start = me.start.clone().startOf('month').subtract(1, 'month');
			me.end = me.end.clone().endOf('month').add(1, 'month');
		}
	},
	setup_dates: function() {
		this.dates = [];
		var cur_date = null;
		while(cur_date === null || cur_date < this.end) {
			if(!cur_date) {
				cur_date = this.start.clone();
			} else {
				cur_date = this.view_is('Month') ?
					cur_date = cur_date.clone().add(1, 'month'):
					cur_date.clone().add(this.opts.step, 'hours');
			}
			this.dates.push(cur_date);
		}
	},
	setup_groups: function() {
		var me = this;
		// make group layers
		["grid", "date", "arrow",
		"progress", "bar", "details"].forEach(function(name) {
			me.groups[name] = me.canvas.group().attr({'id': name});
		});
	},
	get_view_modes: function() {
		return this.opts.valid_view_modes || [];
	},
	set_view_mode: function(mode) {
		this.set_scale(mode);
		this.prepare();
		this.render();
	},
	set_scale: function (scale) {
		this.view_mode = scale;

		//fire viewmode_change event
		this.events.on_viewmode_change(scale);
		if(scale === 'Day') {
			this.opts.step = 24;
			this.opts.column_width = 38;
		}
		else if(scale === 'Half Day') {
			this.opts.step = 24 / 2;
			this.opts.column_width = 38;
		}
		else if(scale === 'Quarter Day') {
			this.opts.step = 24 / 4;
			this.opts.column_width = 38;
		}
		else if(scale === 'Week') {
			this.opts.step = 24 * 7;
			this.opts.column_width = 140;
		}
		else if(scale === 'Month') {
			this.opts.step = 24 * 30;
			this.opts.column_width = 120;
		}
	},
	add_task: function(task) {
		task._index = this.tasks.length;
		this.tasks.push(task);
		this.prepare_dates();
	},
	set_width: function () {
		var cur_width = this.canvas.node.getBoundingClientRect().width;
		var actual_width = this.canvas.getBBox().width;
		if(cur_width < actual_width)
			this.canvas.attr("width", actual_width);
	},
	set_scroll_position: function() {
		document.querySelector(this.opts.parent_selector).parentElement.scrollLeft =
				this.get_min_date().diff(this.start, 'hours') / this.opts.step * this.opts.column_width;
	},
	get_min_date: function() {
		return this.tasks.reduce(function(acc, curr) {
			return curr._start.isSameOrBefore(acc._start) ? curr : acc;
		})._start;
	},
	make_grid: function () {
		this.make_grid_background();
		this.make_grid_rows();
		this.make_grid_header();
		this.make_grid_ticks();
		this.make_grid_highlights();
	},
	make_grid_background: function () {
		var me = this;
		var grid_width = this.opts.label_width + this.dates.length * this.opts.column_width,
			grid_height = this.opts.header_height + this.opts.padding +
				(this.opts.bar.height + this.opts.padding) * this.tasks.length;

		this.canvas.rect(0,0, grid_width, grid_height)
			.addClass('grid-background')
			.appendTo(this.groups.grid);

		this.canvas.attr({
			// viewBox: "0 0 " + (x+10) + " " + (y+10),
			height: grid_height + me.opts.padding,
			width: "100%"
		});
	},
	make_grid_header: function () {
		var me = this;
		var header_width = this.opts.label_width + this.dates.length * this.opts.column_width,
			header_height = this.opts.header_height + 10;
		me.canvas.rect(0,0, header_width, header_height)
			.addClass('grid-header')
			.appendTo(me.groups.grid);
	},
	make_grid_rows: function () {
		var
		me = this,
		rows = me.canvas.group()
			.appendTo(me.groups.grid),
		lines = me.canvas.group()
			.appendTo(me.groups.grid),

		row_width = me.opts.label_width + me.dates.length * me.opts.column_width,
		row_height = me.opts.bar.height + me.opts.padding,
		row_y = me.opts.header_height + me.opts.padding/2;

		this.tasks.forEach(function (task, i) {
			var row_class = i % 2 ? "row-odd" : "row-even";
			me.canvas.rect(0, row_y, row_width, row_height)
				.addClass(row_class)
				.appendTo(rows);

			me.canvas.line(0, row_y + row_height, row_width, row_y + row_height)
				.addClass('row-line')
				.appendTo(lines);
			row_y += me.opts.bar.height + me.opts.padding;
		});
	},
	make_grid_ticks: function () {
		var me = this;
		var tick_x = me.opts.label_width;
		var tick_y = me.opts.header_height + me.opts.padding/2;
		var tick_height = (me.opts.bar.height + me.opts.padding) * me.tasks.length;

		this.dates.forEach(function(date) {
			var tick_class = 'tick';
			//thick tick for monday
			if(me.view_mode === 'Day' && date.day() === 1) {
				tick_class += ' thick';
			}
			//thick tick for first week
			if(me.view_mode === 'Week' && date.date() >= 1 && date.date() < 8) {
				tick_class += ' thick';
			}
			//thick ticks for quarters
			if(me.view_mode === 'Month' && date.month() % 3 === 0) {
				tick_class += ' thick';
			}

			me.canvas.path(Snap.format("M {x} {y} v {height}", {
				x: tick_x,
				y: tick_y,
				height: tick_height
			}))
			.addClass(tick_class)
			.appendTo(me.groups.grid);

			if(me.view_mode === 'Month') {
				tick_x += date.daysInMonth() * me.opts.column_width/30;
			} else {
				tick_x += me.opts.column_width;
			}
		});
	},
	make_grid_highlights: function() {
		var me = this;
		//highlight today's date
		if(me.view_mode === 'Day') {
			var x = me.opts.label_width +
				moment().startOf('day').diff(me.start, 'hours') / me.opts.step *
				me.opts.column_width,
			y = 0,
			width = me.opts.column_width,
			height = (me.opts.bar.height + me.opts.padding) * me.tasks.length +
				me.opts.header_height + me.opts.padding/2;
			me.canvas.rect(x, y, width, height)
				.addClass('today-highlight')
				.appendTo(me.groups.grid);
		}
	},
	make_dates: function() {
		var me = this;

		this.dates.forEach(function(date, i) {
			var primary_text = '';
			var secondary_text = '';
			if(i===0) {
				primary_text = me.get_date_text(date, "primary");
				secondary_text = me.get_date_text(date);
			} else {
				if(me.view_mode === 'Day') {
					primary_text = date.date() !== me.dates[i-1].date() ?
						me.get_date_text(date, "primary") : "";
					secondary_text = date.month() !== me.dates[i-1].month() ?
						me.get_date_text(date) : "";
				}
				else if(me.view_mode === 'Quarter Day') {
					primary_text = me.get_date_text(date, "primary");
					secondary_text = date.date() !== me.dates[i-1].date() ?
						me.get_date_text(date) : "";
				}
				else if(me.view_mode === 'Half Day') {
					primary_text = me.get_date_text(date, "primary");
					secondary_text = date.date() !== me.dates[i-1].date() ?
						me.get_date_text(date) : "";
				}
				else if(me.view_mode === 'Week') {
					primary_text = me.get_date_text(date, "primary");
					secondary_text = date.month() !== me.dates[i-1].month() ?
						me.get_date_text(date) : "";
				}
				else if(me.view_mode === 'Month') {
					primary_text = me.get_date_text(date, "primary");
					secondary_text = date.year() !== me.dates[i-1].year() ?
						me.get_date_text(date) : "";
				}
			}
			var primary_text_x = me.opts.label_width + (i * me.opts.column_width),
				primary_text_y = me.opts.header_height,
				secondary_text_x = me.opts.label_width + (i * me.opts.column_width),
				secondary_text_y = me.opts.header_height - 25;

			if(me.view_mode === 'Month') {
				primary_text_x += (date.daysInMonth() * me.opts.column_width/30)/2;
				secondary_text_x += (me.opts.column_width * 12)/2;
			}
			if(me.view_mode === 'Week') {
				primary_text_x += me.opts.column_width/2;
				secondary_text_x += (me.opts.column_width * 4)/2;
			}
			if(me.view_mode === 'Day') {
				primary_text_x += me.opts.column_width/2;
				secondary_text_x += (me.opts.column_width * 30)/2;
			}
			if(me.view_mode === 'Quarter Day') {
				secondary_text_x += (me.opts.column_width * 4)/2;
			}
			if(me.view_mode === 'Half Day') {
				secondary_text_x += (me.opts.column_width * 2)/2;
			}

			me.canvas.text(primary_text_x, primary_text_y, primary_text)
				.addClass('primary-text')
				.appendTo(me.groups.date);
			if(secondary_text) {
				var $secondary_text = me.canvas.text(secondary_text_x, secondary_text_y, secondary_text)
					.addClass('secondary-text')
					.appendTo(me.groups.date);

				if($secondary_text.getBBox().x2 > me.groups.grid.getBBox().width) {
					$secondary_text.remove();
				}
			}
		});
	},
	get_date_text: function(date, primary) {
		var scale = this.view_mode;
		var text = "";
		if(scale === 'Day') {
			text = (primary) ? date.format('D') : date.format('MMMM');
		}
		else if(scale === 'Quarter Day' || scale === 'Half Day') {
			text = (primary) ? date.format('HH') : date.format('D MMM');
		}
		else if(scale === 'Week') {
			text = (primary) ? "Week " + date.format('W') : date.format('MMMM');
		}
		else if(scale === 'Month') {
			text = (primary) ? date.format('MMMM') : date.format('YYYY');
		}
		return text;
	},
	make_arrows: function () {
		var me = this;
		this.tasks.forEach(function (task) {
			if(task.dependent) {
				var dependents = task.dependent.split(',');
				dependents.forEach(function (task_dependent) {
					var dependent = me.get_task(task_dependent.trim());
					if(!dependent) return;
					var arrow = new Arrow({
						gantt: me,
						from_task: me._bars[dependent._index],
						to_task: me._bars[task._index]
					});
					me.groups.arrow.add(arrow.element);
					me._arrows.push(arrow);
				});
			}
		});
	},

	make_label: function () {
		var me = this;
		var label_x = me.opts.label_width - me.opts.padding,
			label_y = me.opts.header_height + me.opts.bar.height/2 + me.opts.padding;

		this.tasks.forEach(function (task) {
			me.canvas.text(label_x, label_y, task.name).appendTo(me.groups.label);
			label_y += me.opts.bar.height + me.opts.padding;
		});

		me.groups.label.attr({
			"text-anchor": "end",
			"dominant-baseline": "central"
		});
	},
	make_bars: function () {
		var me = this;

		this.tasks.forEach(function (task, i) {
			var bar = new Bar({
				canvas: me.canvas,
				task: task,
				gantt: {
					offset: me.opts.label_width,
					unit_width: me.opts.column_width,
					step: me.opts.step,
					start: me.start,
					header_height: me.opts.header_height,
					padding: me.opts.padding,
					view_mode: me.view_mode
				},
				popover_group: me.groups.details
			});
			me._bars.push(bar);
			me.groups.bar.add(bar.group);
		});
	},
	set_arrows_on_bars: function() {
		var me = this;
		this._bars.forEach(function(bar) {
			bar.arrows = me._arrows.filter(function(arrow) {
				if(arrow.from_task.task.id === bar.task.id || arrow.to_task.task.id === bar.task.id)
					return arrow;
			});
		});
	},
	setup_events: function() {
		var me = this;
		this._bars.forEach(function(bar) {
			bar.events.on_date_change = me.events.bar_on_date_change;
			bar.events.on_progress_change = me.events.bar_on_progress_change;
			bar.click(me.events.bar_on_click);
		});
	},
	bind_grid_click: function() {
		var me = this;
		this.groups.grid.click(function() {
			me.canvas.selectAll('.bar-wrapper').forEach(function(el) {
				el.removeClass('active');
			});
		});
	},
	view_is: function(modes) {
		var me = this;
		if (typeof modes === 'string') {
			return me.view_mode === modes;
		} else {
			modes.reduce(function(acc, curr) {
				return (me.view_mode === curr) || acc
			}, false);
			// for (var i = 0; i < modes.length; i++) {
			// 	if(me.gantt.view_mode === modes[i]) return true;
			// }
			// return false;
		}
	},
	get_task: function (id) {
		var result = null;
		this.tasks.forEach(function (task) {
			if (task.id === id){
				result = task;
			}
		});
		return result;
	}
});
