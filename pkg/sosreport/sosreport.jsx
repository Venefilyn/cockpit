/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2021 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

import '../lib/patternfly/patternfly-6-cockpit.scss';
import "polyfills";
import 'cockpit-dark-theme'; // once per page

import React, { useState } from "react";
import { createRoot } from 'react-dom/client';
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { CodeBlockCode } from "@patternfly/react-core/dist/esm/components/CodeBlock/index.js";
import {
    Modal, ModalBody, ModalFooter, ModalHeader
} from '@patternfly/react-core/dist/esm/components/Modal/index.js';
import { Card, CardBody, CardHeader, CardTitle } from '@patternfly/react-core/dist/esm/components/Card/index.js';
import { Page, PageSection, } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { Flex } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Label, LabelGroup } from "@patternfly/react-core/dist/esm/components/Label/index.js";
import { DropdownItem } from '@patternfly/react-core/dist/esm/components/Dropdown/index.js';
import { Form, FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { InputGroup } from "@patternfly/react-core/dist/esm/components/InputGroup/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";
import { Checkbox } from "@patternfly/react-core/dist/esm/components/Checkbox/index.js";
import { EyeIcon, EyeSlashIcon } from '@patternfly/react-icons';

import { EmptyStatePanel } from "cockpit-components-empty-state.jsx";
import { ListingTable } from "cockpit-components-table.jsx";
import { basename as path_basename } from "cockpit-path";

import cockpit from "cockpit";
import { useObject, useEvent } from "hooks";
import { superuser } from "superuser";
import * as python from "python";
import { FsInfoClient } from "cockpit/fsinfo";

import { SuperuserButton } from "../shell/superuser.jsx";

import { fmt_to_fragments } from "utils.jsx";
import * as timeformat from "timeformat";
import { WithDialogs, useDialogs } from "dialogs.jsx";
import { FormHelper } from "cockpit-components-form-helper";
import { KebabDropdown } from "cockpit-components-dropdown";

import get_report_dir_py from "./get_report_dir.py";

import './sosreport.scss';

const _ = cockpit.gettext;

function sosLister() {
    const self = {
        ready: false,
        problem: null,
        reports: {}
    };

    cockpit.event_target(self);

    function emit_changed() {
        self.dispatchEvent("changed");
    }

    function parse_report_name(name, date) {
        const archive_rx = /^(secured-)?sosreport-(.*)\.tar\.[^.]+(\.gpg)?$/;
        const m = name.match(archive_rx);
        if (m) {
            let name = m[2];
            let obfuscated = false;
            if (name.endsWith("-obfuscated")) {
                obfuscated = true;
                name = name.replace(/-obfuscated$/, "");
            }

            return {
                name,
                encrypted: !!m[1],
                obfuscated,
                date,
            };
        }
    }

    let fsinfo = null;

    async function restart() {
        if (superuser.allowed === null)
            return;

        if (fsinfo)
            fsinfo.close();
        self.ready = false;
        self.problem = null;

        const report_dir = (await python.spawn(get_report_dir_py)).trim();

        fsinfo = new FsInfoClient(report_dir, ["entries", "mtime", "type"], { superuser: "require" });
        fsinfo.on("change", state => {
            if (state.loading)
                return;
            if (state.error) { // Should Not Happen™, realistic errors come through close event
                console.warn("Failed to watch for sosreports:", state.error);
                self.problem = state.error.message ?? state.error.problem;
                emit_changed();
                return;
            }
            const entries = state.info?.entries;
            const reports = { };
            for (const name in entries) {
                if (entries[name].type == "reg") {
                    const report = parse_report_name(name, entries[name].mtime);
                    if (report)
                        reports[report_dir + '/' + name] = report;
                }
            }
            self.reports = reports;
            self.ready = true;
            emit_changed();
        });

        fsinfo.on("close", ex => {
            self.problem = ex.problem;
            self.ready = true;
            emit_changed();
        });
    }

    restart();
    superuser.addEventListener("changed", restart);
    return self;
}

function sosCreate(args, setProgress, setError, setErrorDetail) {
    let output = "";
    let plugins_count = 0;
    const progress_regex = /Running ([0-9]+)\/([0-9]+):/; // Only for sos < 3.6
    const finishing_regex = /Finishing plugins.*\[Running: (.*)\]/;
    const starting_regex = /Starting ([0-9]+)\/([0-9]+).*\[Running: (.*)\]/;

    // TODO - Use a real API instead of scraping stdout once such an API exists
    const task = cockpit.spawn(["sos", "report", "--batch"].concat(args),
                               { superuser: "require", err: "out", pty: true });

    task.stream(text => {
        let p = 0;
        let m;

        output += text;
        const lines = output.split("\n");
        for (let i = lines.length - 1; i >= 0; i--) {
            if ((m = starting_regex.exec(lines[i]))) {
                plugins_count = parseInt(m[2], 10);
                p = ((parseInt(m[1], 10) - m[3].split(" ").length) / plugins_count) * 100;
                break;
            } else if ((m = finishing_regex.exec(lines[i]))) {
                if (!plugins_count)
                    p = 100;
                else
                    p = ((plugins_count - m[1].split(" ").length) / plugins_count) * 100;
                break;
            } else if ((m = progress_regex.exec(lines[i]))) {
                p = (parseInt(m[1], 10) / parseInt(m[2], 10)) * 100;
                break;
            }
        }

        setProgress(p);
    });

    task.catch(error => {
        // easier investigation of failures, errors in pty mode may be hard to see
        if (error.problem !== 'cancelled')
            console.error("Failed to call sos report:", JSON.stringify(error));
        setError(error.toString() || _("sos report failed"));
        setErrorDetail(output);
    });

    return task;
}

function sosDownload(path) {
    const basename = path_basename(path);
    const query = window.btoa(JSON.stringify({
        host: cockpit.transport.host,
        payload: "fsread1",
        binary: "raw",
        path,
        superuser: "require",
        max_read_size: 150 * 1024 * 1024,
        external: {
            "content-disposition": 'attachment; filename="' + basename + '"',
            "content-type": "application/x-xz, application/octet-stream"
        }
    }));
    const prefix = (new URL(cockpit.transport.uri("channel/" + cockpit.transport.csrf_token))).pathname;
    const url = prefix + '?' + query;
    return new Promise((resolve, reject) => {
        // We download via a hidden iframe to get better control over the error cases
        const iframe = document.createElement("iframe");
        iframe.setAttribute("src", url);
        iframe.setAttribute("hidden", "hidden");
        iframe.addEventListener("load", () => {
            const title = iframe.contentDocument.title;
            if (title) {
                reject(title);
            } else {
                resolve();
            }
        });
        document.body.appendChild(iframe);
    });
}

function sosRemove(path) {
    // there are various potential extra files; not all of them are expected to exist,
    // the file API tolerates removing nonexisting files
    const paths = [
        path,
        path + ".asc",
        path + ".gpg",
        path + ".md5",
        path + ".sha256",
    ];
    return Promise.all(paths.map(p => cockpit.file(p, { superuser: "require" }).replace(null)));
}

const SOSDialog = () => {
    const Dialogs = useDialogs();
    const [label, setLabel] = useState("");
    const [passphrase, setPassphrase] = useState("");
    const [showPassphrase, setShowPassphrase] = useState(false);
    const [obfuscate, setObfuscate] = useState(false);
    const [verbose, setVerbose] = useState(false);
    const [task, setTask] = useState(null);
    const [progress, setProgress] = useState(null);
    const [error, setError] = useState(null);
    const [errorDetail, setErrorDetail] = useState(null);

    function run() {
        setError(null);
        setProgress(null);

        const args = [];

        if (label) {
            args.push("--label");
            args.push(label);
        }

        if (passphrase) {
            args.push("--encrypt-pass");
            args.push(passphrase);
        }

        if (obfuscate) {
            args.push("--clean");
        }

        if (verbose) {
            args.push("-v");
        }

        const task = sosCreate(args, setProgress, err => { if (err == "cancelled") Dialogs.close(); else setError(err); },
                               setErrorDetail);
        setTask(task);
        task.then(Dialogs.close);
        task.finally(() => setTask(null));
    }

    const actions = [];
    actions.push(<Button key="run" isLoading={!!task} isDisabled={!!task} onClick={run}>
        {_("Run report")}
    </Button>);
    if (task)
        actions.push(<Button key="stop" variant="secondary" onClick={() => task.close("cancelled")}>
            {_("Stop report")}
        </Button>);
    else
        actions.push(<Button key="cancel" variant="link" onClick={Dialogs.close}>
            {_("Cancel")}
        </Button>);

    return <Modal id="sos-dialog"
                  position="top"
                  variant="medium"
                  isOpen
                  onClose={Dialogs.close}>
        <ModalHeader title={ _("Run new report") } />
        <ModalBody>
            { error
                ? <>
                    <Alert variant="warning" isInline title={error}>
                        <CodeBlockCode>{errorDetail}</CodeBlockCode>
                    </Alert>
                    <br />
                </>
                : null }
            <p>{ _("SOS reporting collects system information to help with diagnosing problems.") }</p>
            <p>{ _("This information is stored only on the system.") }</p>
            <br />
            <Form isHorizontal>
                <FormGroup label={_("Report label")}>
                    <TextInput id="sos-dialog-ti-1" value={label} onChange={(_event, value) => setLabel(value)} />
                </FormGroup>
                <FormGroup label={_("Encryption passphrase")}>
                    <InputGroup>
                        <TextInput type={showPassphrase ? "text" : "password"} value={passphrase} onChange={(_event, value) => setPassphrase(value)}
                                   id="sos-dialog-ti-2" autoComplete="new-password" />
                        <Button variant="control" onClick={() => setShowPassphrase(!showPassphrase)}>
                            { showPassphrase ? <EyeSlashIcon /> : <EyeIcon /> }
                        </Button>
                    </InputGroup>
                    <FormHelper helperText={_("Leave empty to skip encryption")} />
                </FormGroup>
                <FormGroup label={_("Options")} hasNoPaddingTop>
                    <Checkbox label={_("Obfuscate network addresses, hostnames, and usernames")}
                              id="sos-dialog-cb-1" isChecked={obfuscate} onChange={(_, o) => setObfuscate(o)} />
                    <Checkbox label={_("Use verbose logging")}
                              id="sos-dialog-cb-2" isChecked={verbose} onChange={(_, v) => setVerbose(v)} />
                </FormGroup>
            </Form>
        </ModalBody>
        <ModalFooter>
            {actions}
            {progress ? <span>{cockpit.format(_("Progress: $0"), progress.toFixed() + "%")}</span> : null}
        </ModalFooter>
    </Modal>;
};

const SOSRemoveDialog = ({ path }) => {
    const Dialogs = useDialogs();
    const [task, setTask] = useState(null);
    const [error, setError] = useState(null);

    function remove() {
        setError(null);
        setTask(sosRemove(path)
                .then(Dialogs.close)
                .catch(err => {
                    setTask(null);
                    setError(err.toString());
                }));
    }

    return (
        <Modal id="sos-remove-dialog"
               position="top"
               variant="medium"
               isOpen
               onClose={Dialogs.close}>
            <ModalHeader title={_("Delete report permanently?")} titleIconVariant="warning" />
            <ModalBody>
                { error && <><Alert variant="warning" isInline title={error} /><br /></> }
                <p>{fmt_to_fragments(_("The file $0 will be deleted."), <b>{path}</b>)}</p>
            </ModalBody>
            <ModalFooter>
                <Button key="apply"
                        variant="danger"
                        onClick={remove}
                        isLoading={!!task}
                        isDisabled={!!task}>
                    {_("Delete")}
                </Button>
                <Button key="cancel"
                        onClick={Dialogs.close}
                        isDisabled={!!task}
                        variant="link">
                    {_("Cancel")}
                </Button>
            </ModalFooter>
        </Modal>);
};

const SOSErrorDialog = ({ error }) => {
    const Dialogs = useDialogs();

    return (
        <Modal id="sos-error-dialog"
               position="top"
               variant="medium"
               isOpen
               onClose={Dialogs.close}>
            <ModalHeader title={ _("Error") } />
            <ModalBody>
                <p>{error}</p>
            </ModalBody>
        </Modal>);
};

const MenuItem = ({ onClick, onlyNarrow, children }) => (
    <DropdownItem className={onlyNarrow ? "show-only-when-narrow" : null}
                  onKeyDown={onClick}
                  onClick={onClick}>
        {children}
    </DropdownItem>
);

const SOSBody = () => {
    const Dialogs = useDialogs();
    const lister = useObject(sosLister, obj => obj.close, []);
    useEvent(lister, "changed");

    const superuser_proxy = useObject(() => cockpit.dbus(null, { bus: "internal" }).proxy("cockpit.Superuser",
                                                                                          "/superuser"),
                                      obj => obj.close(),
                                      []);
    useEvent(superuser_proxy, "changed");

    if (!lister.ready)
        return <EmptyStatePanel loading />;

    if (lister.problem) {
        if (lister.problem == "access-denied")
            return (
                <EmptyStatePanel
                    title={_("Administrative access required")}
                    paragraph={_("Administrative access is required to create and access reports.")}
                    action={<SuperuserButton />} />);
        else
            return <EmptyStatePanel title={lister.problem} />;
    }

    function run_report() {
        Dialogs.show(<SOSDialog />);
    }

    function make_report_row(path) {
        const report = lister.reports[path];

        function download() {
            sosDownload(path).catch(err => Dialogs.show(<SOSErrorDialog error={err.toString()} />));
        }

        function remove() {
            Dialogs.show(<SOSRemoveDialog path={path} />);
        }

        const labels = [];
        if (report.encrypted)
            labels.push(<Label key="enc" color="orange">
                {_("Encrypted")}
            </Label>);
        if (report.obfuscated)
            labels.push(<Label key="obf" color="grey">
                {_("Obfuscated")}
            </Label>);

        const action = (
            <Button variant="secondary" className="show-only-when-wide"
                    onClick={download}>
                {_("Download")}
            </Button>);
        const menu = <KebabDropdown dropdownItems={[
            <MenuItem key="download"
                      onlyNarrow
                      onClick={download}>
                {_("Download")}
            </MenuItem>,
            <MenuItem key="remove"
                      onClick={remove}>
                {_("Delete")}
            </MenuItem>
        ]} />;

        return {
            props: { key: path },
            columns: [
                report.name,
                timeformat.distanceToNow(new Date(report.date * 1000)),
                { title: <LabelGroup>{labels}</LabelGroup> },
                {
                    title: <>{action}{menu}</>,
                    props: { className: "pf-v6-c-table__action table-row-action" }
                },
            ]
        };
    }

    return (
        <PageSection hasBodyWrapper={false}>
            <Card isPlain className="ct-card">
                <CardHeader actions={{
                    actions: <Button id="create-button" variant="primary" onClick={run_report}>
                        {_("Run report")}
                    </Button>,
                }}>
                    <CardTitle component="h2">{_("Reports")}</CardTitle>
                </CardHeader>
                <CardBody className="contains-list">
                    <ListingTable emptyCaption={_("No system reports.")}
                                  columns={ [
                                      { title: _("Report") },
                                      { title: _("Created") },
                                      { title: _("Attributes") },
                                  ] }
                                  rows={Object
                                          .keys(lister.reports)
                                          .sort((a, b) => lister.reports[b].date - lister.reports[a].date)
                                          .map(make_report_row)} />
                </CardBody>
            </Card>
        </PageSection>);
};

const SOSPage = () => {
    return (
        <WithDialogs>
            <Page className='no-masthead-sidebar'>
                <PageSection hasBodyWrapper={false} padding={{ default: "padding" }}>
                    <Flex alignItems={{ default: 'alignItemsCenter' }}>
                        <h2 className="pf-v6-u-font-size-3xl">{_("System diagnostics")}</h2>
                    </Flex>
                </PageSection>
                <SOSBody />
            </Page>
        </WithDialogs>);
};

document.addEventListener("DOMContentLoaded", () => {
    cockpit.translate();
    const root = createRoot(document.getElementById('app'));
    root.render(<SOSPage />);
});
