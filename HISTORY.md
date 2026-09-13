# Why RackDown exists

RackDown started from a fairly ordinary problem: documenting racks should not need another small infrastructure project attached to it.

There are already good rack-layout tools around, but in environments I've been in, you are told to justify everything from, licences, hosting, support, upgrades, ownership, business rules, blah, blah, as well as whatever approval processes that sit between something useful and the powers that be.
If it isn't simple to run and maintain, the mental energy can be harder to justify than the problem it solves. Usually that means the idea dies after consuming far more emotional and mental energy than the organisation deserved.

In my part of the world, a natural fallback for some silly reason is usually a spreadsheet in a proprietary format _(shocking I know!)_. It seems to be there, everyone can open it, and nobody has to approve another service. It is also a fairly miserable way to describe the physical shape of a rack and the connections and/or relationships between the things in it. Spreadsheets are the inevitable depressing fallback, and honestly, they can fuck right off, especially if you start slapping images into them.

I wanted instead was something closer to writing a note, and to describe the rack and/or the equipment in plain text, keep it somewhere I already work, and generate diagram come from the simple same source.

Rackula was something I thought could be useful, but required hosting and needs to run in an appliance, so that wasn't going to work in my world.
I figured that RackDown could take a different path by putting the source text first. A RackDown file or text in a host application should still be readable and useful, it could be in a note, or viewable as text in Git even if the renderer is not around.

This also shaped how forgiving the RackDown tries to be. Real racks _(At least where I am from)_ are untidy, have terrible documentation that gets edited by hand, and hardware does not always match a nice catalogue definition. An unknown device, an extra NIC or a half-written line should not break the rest of the rack or make it vanish. If we can recover sensibly _(hopefully)_, RackDown keeps going and reports back what might be wrong.

I'd generally prefer to trust the person documenting the rack instead of trying to track and trace every edge case. Device definitions can also add useful facts about typical hardware, but an installation may differ. As such, catalogue information therefore helps enrich the diagram rather than deciding what somebody is allowed to install or connect.

The [NetBox Community Device Type Library](https://github.com/netbox-community/devicetype-library) gives RackDown a community-maintained source of hardware identities and endpoint information without inventing yet another catalogue. We keep its [licence and provenance](docs/upstream-catalogue.md) intact and only normalise the pieces that are useful for rack documentation.

The same preference for low overhead is why core currently stays independent of any one host. Obsidian is super useful because it can turn RackDown blocks into rack diagrams inside notes quickly, and the browser playground is useful for, well... being a playgound, but neither one defines RackDown. SVG, similarly is just one way of drawing the resolved rack rather than becoming the rack itself.

RackDown is an experiment that started in a scratchpad before I thought I'd move it into its own repository, so friends can also ignore it.
The public repository is starting from a cleaner baseline rather than carrying over thousands of commits and every broken experiment, abandoned idea and note. Does this history matter? Probably not, and I don't think anything would really read this anyway.

Do I think this will ever be used in my environment? Doubtful, but at least I can use it for home and if other people find it useful, that's a bonus.
